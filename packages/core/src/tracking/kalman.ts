/**
 * Constant-velocity Kalman filter over (cx, cy, aspect, h), as used by ByteTrack / SORT.
 * State is 8-dimensional: position terms followed by their velocities.
 */

type Mat = number[][];

const STD_POS = 1 / 20;
const STD_VEL = 1 / 160;

function zeros(r: number, c: number): Mat {
  return Array.from({ length: r }, () => new Array<number>(c).fill(0));
}

function diag(values: number[]): Mat {
  const m = zeros(values.length, values.length);
  values.forEach((v, i) => (m[i][i] = v));
  return m;
}

function mul(a: Mat, b: Mat): Mat {
  const out = zeros(a.length, b[0].length);
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < b.length; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < b[0].length; j++) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

function transpose(a: Mat): Mat {
  return a[0].map((_, j) => a.map((row) => row[j]));
}

function add(a: Mat, b: Mat): Mat {
  return a.map((row, i) => row.map((v, j) => v + b[i][j]));
}

function sub(a: Mat, b: Mat): Mat {
  return a.map((row, i) => row.map((v, j) => v - b[i][j]));
}

/** Gauss-Jordan inverse; matrices here are small and symmetric positive-definite. */
function invert(a: Mat): Mat {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...diag(new Array(n).fill(1))[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col] || 1e-12;
    for (let j = 0; j < 2 * n; j++) m[col][j] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row.slice(n));
}

const F: Mat = (() => {
  const m = diag(new Array(8).fill(1));
  for (let i = 0; i < 4; i++) m[i][i + 4] = 1;
  return m;
})();
const FT = transpose(F);
const H: Mat = zeros(4, 8).map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
const HT = transpose(H);

export interface KalmanState {
  mean: number[];
  cov: Mat;
}

export function initiate(z: number[]): KalmanState {
  const h = z[3];
  const std = [
    2 * STD_POS * h, 2 * STD_POS * h, 1e-2, 2 * STD_POS * h,
    10 * STD_VEL * h, 10 * STD_VEL * h, 1e-5, 10 * STD_VEL * h,
  ];
  return { mean: [...z, 0, 0, 0, 0], cov: diag(std.map((s) => s * s)) };
}

export function predict(s: KalmanState): KalmanState {
  const h = s.mean[3];
  const std = [
    STD_POS * h, STD_POS * h, 1e-2, STD_POS * h,
    STD_VEL * h, STD_VEL * h, 1e-5, STD_VEL * h,
  ];
  const mean = mul(F, s.mean.map((v) => [v])).map((r) => r[0]);
  const cov = add(mul(mul(F, s.cov), FT), diag(std.map((v) => v * v)));
  return { mean, cov };
}

export function update(s: KalmanState, z: number[]): KalmanState {
  const h = s.mean[3];
  const R = diag([STD_POS * h, STD_POS * h, 1e-1, STD_POS * h].map((v) => v * v));
  const projMean = s.mean.slice(0, 4);
  const S = add(mul(mul(H, s.cov), HT), R);
  const K = mul(mul(s.cov, HT), invert(S));
  const innovation = z.map((v, i) => [v - projMean[i]]);
  const mean = add(s.mean.map((v) => [v]), mul(K, innovation)).map((r) => r[0]);
  const cov = sub(s.cov, mul(mul(K, S), transpose(K)));
  return { mean, cov };
}
