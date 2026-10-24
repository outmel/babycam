/**
 * On-device cry detection: 16 kHz mono microphone audio → YAMNet every 0.5 s → crying score.
 * Audio stays in a small in-memory ring buffer and is never recorded or uploaded.
 */
import { AudioManager, AudioRecorder } from 'react-native-audio-api';
import type { TfliteModel } from 'react-native-fast-tflite';
import { Platform } from 'react-native';

import classes from '../../assets/models/yamnet_classes.json';

const SAMPLE_RATE = 16000;
const WINDOW = 15600; // YAMNet's 0.975 s input
const HOP = 8000; // score every 0.5 s

export class CryListener {
  private recorder: AudioRecorder | null = null;
  private ring = new Float32Array(WINDOW);
  private filled = 0;
  private busy = false;

  constructor(
    private readonly model: TfliteModel,
    private readonly onScore: (cry: number, level: number) => void,
  ) {}

  static async requestPermission(): Promise<boolean> {
    return (await AudioManager.requestRecordingPermissions()) === 'Granted';
  }

  async start(): Promise<void> {
    if (this.recorder) return;
    if (Platform.OS === 'ios') {
      AudioManager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'measurement', iosOptions: ['mixWithOthers', 'defaultToSpeaker'] });
      await AudioManager.setAudioSessionActivity(true);
    }
    const recorder = new AudioRecorder();
    recorder.onAudioReady({ sampleRate: SAMPLE_RATE, bufferLength: HOP, channelCount: 1 }, ({ buffer }) => {
      this.push(buffer.getChannelData(0), buffer.sampleRate);
    });
    const res = await recorder.start();
    if (res.status !== 'success') throw new Error('Microphone could not start');
    this.recorder = recorder;
  }

  async stop(): Promise<void> {
    const r = this.recorder;
    this.recorder = null;
    if (!r) return;
    r.clearOnAudioReady();
    await r.stop();
    this.filled = 0;
  }

  private push(samples: Float32Array, rate: number): void {
    const data = rate === SAMPLE_RATE ? samples : resample(samples, rate, SAMPLE_RATE);
    // Slide the window left and append the new hop.
    const n = Math.min(data.length, WINDOW);
    this.ring.copyWithin(0, n);
    this.ring.set(data.subarray(data.length - n), WINDOW - n);
    this.filled = Math.min(WINDOW, this.filled + n);
    if (this.filled < WINDOW || this.busy) return;
    this.busy = true;
    let sumSq = 0;
    for (let i = WINDOW - n; i < WINDOW; i++) sumSq += this.ring[i] * this.ring[i];
    const level = Math.sqrt(sumSq / n);
    const input = this.ring.slice();
    this.model
      .run([input.buffer])
      .then((out) => {
        const scores = new Float32Array(out[0]);
        let cry = 0;
        for (const i of classes.cry) cry = Math.max(cry, scores[i] ?? 0);
        this.onScore(cry, level);
      })
      .catch(() => {})
      .finally(() => {
        this.busy = false;
      });
  }
}

/** Linear resampling for devices that can't record at 16 kHz directly. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (x - i0);
  }
  return out;
}
