/**
 * Minimum-cost assignment with a cost limit, matching the behaviour of `lap.lapjv(..., cost_limit)`
 * that ByteTrack uses. Rows/cols whose best pairing costs more than `limit` stay unmatched.
 */
export interface AssignmentResult {
  matches: [number, number][];
  unmatchedRows: number[];
  unmatchedCols: number[];
}

/** `cols` must be given when `cost` may have zero rows, since the width can't be read from it then. */
export function linearAssignment(cost: number[][], limit: number, cols = cost[0]?.length ?? 0): AssignmentResult {
  const rows = cost.length;
  if (rows === 0 || cols === 0) {
    return {
      matches: [],
      unmatchedRows: [...Array(rows).keys()],
      unmatchedCols: [...Array(cols).keys()],
    };
  }
  // Extend to a square (rows+cols) matrix where every row/col may pair with a dummy at cost limit/2.
  const n = rows + cols;
  const ext: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i < rows && j < cols) return cost[i][j];
      if (i >= rows && j >= cols) return 0;
      return limit / 2;
    }),
  );
  const assign = hungarian(ext);
  const matches: [number, number][] = [];
  const rowMatched = new Array(rows).fill(false);
  const colMatched = new Array(cols).fill(false);
  for (let i = 0; i < rows; i++) {
    const j = assign[i];
    if (j < cols && cost[i][j] <= limit) {
      matches.push([i, j]);
      rowMatched[i] = true;
      colMatched[j] = true;
    }
  }
  return {
    matches,
    unmatchedRows: rowMatched.flatMap((m, i) => (m ? [] : [i])),
    unmatchedCols: colMatched.flatMap((m, j) => (m ? [] : [j])),
  };
}

/** O(n^3) Hungarian algorithm on a square matrix. Returns the column assigned to each row. */
export function hungarian(a: number[][]): number[] {
  const n = a.length;
  const INF = 1e18;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const ans = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] !== 0) ans[p[j] - 1] = j - 1;
  return ans;
}
