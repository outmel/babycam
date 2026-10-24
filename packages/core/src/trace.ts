/**
 * Trace files: JSON Lines recordings of model outputs over time. The camera phone can record
 * one (Settings → Record trace), `harness/extract` builds them from video files, and the replay
 * harness feeds them back through the same Pipeline the app uses.
 */
import { defaultConfig, Pipeline, type PipelineConfig } from './pipeline';
import type { AudioObservation, CameraMount, FrameObservation, LuluEvent, Zone } from './types';

export interface TraceHeader {
  kind: 'header';
  version: 1;
  clip: string;
  source: 'device' | 'video' | 'synthetic';
  mount: CameraMount;
  zones: Zone[];
  durationSec?: number;
  note?: string;
}

export type TraceFrame = { kind: 'frame' } & FrameObservation;
export type TraceAudio = { kind: 'audio' } & AudioObservation;
export type TraceItem = TraceFrame | TraceAudio;

export interface Trace {
  header: TraceHeader;
  items: TraceItem[];
}

export function parseTrace(text: string): Trace {
  let header: TraceHeader | null = null;
  const items: TraceItem[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let obj: { kind?: string };
    try {
      obj = JSON.parse(line);
    } catch {
      throw new Error(`Trace line ${i + 1} is not valid JSON`);
    }
    if (obj.kind === 'header') header = obj as TraceHeader;
    else if (obj.kind === 'frame' || obj.kind === 'audio') items.push(obj as TraceItem);
  });
  if (!header) throw new Error('Trace has no header line');
  items.sort((a, b) => a.t - b.t);
  return { header, items };
}

export function serializeTrace(trace: Trace): string {
  return [trace.header, ...trace.items].map((x) => JSON.stringify(x)).join('\n') + '\n';
}

export function traceDuration(trace: Trace): number {
  if (trace.header.durationSec) return trace.header.durationSec;
  return trace.items.length ? trace.items[trace.items.length - 1].t : 0;
}

/** Run a trace through a fresh Pipeline and collect every event it emits. */
export function replay(trace: Trace, overrides: Partial<PipelineConfig> = {}): LuluEvent[] {
  const pipeline = new Pipeline(
    defaultConfig({ zones: trace.header.zones, mount: trace.header.mount, ...overrides }),
  );
  const events: LuluEvent[] = [];
  for (const item of trace.items) {
    if (item.kind === 'frame') events.push(...pipeline.processFrame(item));
    else events.push(...pipeline.processAudio(item));
  }
  return events;
}
