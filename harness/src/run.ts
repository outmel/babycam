/**
 * Replay harness. Runs every clip in harness/clips (or the folders passed as arguments)
 * through the same Pipeline the app uses, scores the alerts against labels.json, and writes
 * reports/latest.md and reports/latest.json.
 *
 *   npm run replay                 # all clips
 *   npm run replay -- clips/my-rec # specific clips
 *   npm run gate                   # also fail (exit 1) if thresholds.json isn't met
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVENT_META,
  parseTrace,
  replay,
  scoreClip,
  summarize,
  traceDuration,
  type ClipScore,
  type LabelFile,
  type LuluEvent,
  type SuiteSummary,
  type TraceHeader,
} from '../../packages/core/src';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const gate = args.includes('--gate');
const clipArgs = args.filter((a) => !a.startsWith('--'));

interface ClipResult {
  header: TraceHeader;
  score: ClipScore;
  events: LuluEvent[];
}

function findClips(): string[] {
  if (clipArgs.length) return clipArgs.map((p) => resolve(p));
  const dir = join(root, 'clips');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((d) => join(dir, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'trace.jsonl')))
    .sort();
}

function runClip(dir: string): ClipResult {
  const trace = parseTrace(readFileSync(join(dir, 'trace.jsonl'), 'utf8'));
  const labelsPath = join(dir, 'labels.json');
  const labels: LabelFile = existsSync(labelsPath)
    ? JSON.parse(readFileSync(labelsPath, 'utf8'))
    : { clip: trace.header.clip, durationSec: traceDuration(trace), labels: [] };
  labels.durationSec ||= traceDuration(trace);
  const events = replay(trace);
  return { header: trace.header, score: scoreClip(events, labels), events };
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const sec = (x: number | null) => (x === null ? '—' : `${x.toFixed(1)}s`);

function suiteTable(s: SuiteSummary): string {
  const rows = s.byType
    .filter((t) => t.labelled > 0 || t.falseAlarms > 0)
    .map(
      (t) =>
        `| ${EVENT_META[t.type].title} | ${t.labelled} | ${t.truePositives} | ${t.missed} | ${t.falseAlarms} | ${t.falseAlarmsPerHour.toFixed(2)} | ${pct(t.recall)} | ${pct(t.precision)} | ${sec(t.medianLatency)} |`,
    );
  return [
    '| Alert | Labelled | Caught | Missed | False alarms | False alarms / hr | Recall | Precision | Median delay |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows,
    `| **All** | ${s.totals.truePositives + s.totals.missed} | ${s.totals.truePositives} | ${s.totals.missed} | ${s.totals.falseAlarms} | ${s.totals.falseAlarmsPerHour.toFixed(2)} | ${pct(s.totals.recall)} | | |`,
  ].join('\n');
}

function clipLines(r: ClipResult): string {
  const s = r.score;
  const tp = s.byType.reduce((a, t) => a + t.truePositives, 0);
  const labelled = s.byType.reduce((a, t) => a + t.labelled, 0);
  const fa = s.falseAlarmEvents.length;
  const ok = fa === 0 && s.missedLabels.length === 0;
  const lines = [`| ${ok ? '✅' : '❌'} | \`${r.header.clip}\` | ${Math.round(s.durationSec / 60)} min | ${tp}/${labelled} | ${fa} | ${r.header.note ?? ''} |`];
  return lines.join('\n');
}

function details(results: ClipResult[]): string {
  const out: string[] = [];
  for (const r of results) {
    const s = r.score;
    if (!s.falseAlarmEvents.length && !s.missedLabels.length) continue;
    out.push(`**${r.header.clip}**`);
    for (const e of s.falseAlarmEvents) out.push(`- False alarm at ${e.t.toFixed(1)}s: ${e.message}`);
    for (const l of s.missedLabels) out.push(`- Missed ${EVENT_META[l.type].title.toLowerCase()} labelled ${l.start}–${l.end}s`);
    out.push('');
  }
  return out.length ? out.join('\n') : '_None._';
}

function section(title: string, intro: string, results: ClipResult[]): string {
  if (!results.length) return `## ${title}\n\n${intro}\n\n_No clips yet._\n`;
  const s = summarize(results.map((r) => r.score));
  return [
    `## ${title}`,
    '',
    intro,
    '',
    `${s.clips} clips, ${(s.hours * 60).toFixed(0)} minutes in total.`,
    '',
    suiteTable(s),
    '',
    '| | Clip | Length | Caught | False alarms | Scenario |',
    '|---|---|---:|---:|---:|---|',
    ...results.map(clipLines),
    '',
    '### False alarms and misses',
    '',
    details(results),
    '',
  ].join('\n');
}

function checkGate(results: ClipResult[]): string[] {
  const t = JSON.parse(readFileSync(join(root, 'thresholds.json'), 'utf8'));
  const s = summarize(results.map((r) => r.score));
  const failures: string[] = [];
  if (s.totals.falseAlarmsPerHour > t.maxFalseAlarmsPerHour) {
    failures.push(`False alarms ${s.totals.falseAlarmsPerHour.toFixed(2)}/hr > ${t.maxFalseAlarmsPerHour}/hr`);
  }
  for (const ts of s.byType) {
    const min = t.minRecall?.[ts.type];
    if (min !== undefined && ts.recall !== null && ts.recall < min) {
      failures.push(`${EVENT_META[ts.type].title} recall ${pct(ts.recall)} < ${pct(min)}`);
    }
  }
  return failures;
}

const dirs = findClips();
if (!dirs.length) {
  console.error('No clips found. Run `npm run synth` to create the synthetic set, or add recorded clips to harness/clips.');
  process.exit(1);
}
const results = dirs.map(runClip);
const real = results.filter((r) => r.header.source !== 'synthetic');
const synthetic = results.filter((r) => r.header.source === 'synthetic');

const report = [
  '# Lulu replay report',
  '',
  `Generated ${new Date().toISOString()} from ${results.length} clips.`,
  '',
  section(
    'Recorded clips',
    'Model outputs recorded on a camera phone or extracted from real video, so these numbers include detector and classifier error.',
    real,
  ),
  section(
    'Synthetic clips (logic checks)',
    'Simulated detector output with noise, dropouts and distractors. These check the alert rules end to end, not model accuracy.',
    synthetic,
  ),
].join('\n');

mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(join(root, 'reports', 'latest.md'), report);
writeFileSync(
  join(root, 'reports', 'latest.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      recorded: real.length ? summarize(real.map((r) => r.score)) : null,
      synthetic: synthetic.length ? summarize(synthetic.map((r) => r.score)) : null,
      clips: results.map((r) => ({
        clip: r.header.clip,
        source: r.header.source,
        score: r.score,
        events: r.events.filter((e) => e.severity !== 'info'),
      })),
    },
    null,
    2,
  ),
);

for (const [name, set] of [['Recorded', real], ['Synthetic', synthetic]] as const) {
  if (!set.length) continue;
  const s = summarize(set.map((r) => r.score));
  console.log(`\n${name}: ${set.length} clips, ${(s.hours * 60).toFixed(0)} min`);
  console.table(
    Object.fromEntries(
      s.byType
        .filter((t) => t.labelled > 0 || t.falseAlarms > 0)
        .map((t) => [EVENT_META[t.type].title, { caught: `${t.truePositives}/${t.labelled}`, falseAlarms: t.falseAlarms, recall: pct(t.recall), delay: sec(t.medianLatency) }]),
    ),
  );
  console.log(`False alarms per hour: ${s.totals.falseAlarmsPerHour.toFixed(2)}, recall: ${pct(s.totals.recall)}`);
}
console.log(`\nReport written to ${join('harness', 'reports', 'latest.md')}`);

if (gate) {
  const failures = checkGate(real.length ? real : synthetic);
  if (failures.length) {
    console.error(`\nGate failed (${real.length ? 'recorded' : 'synthetic'} clips):\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`\nGate passed (${real.length ? 'recorded' : 'synthetic'} clips).`);
}
void basename;
