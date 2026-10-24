'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';

const SERIES = [
  { key: 'sound', label: 'Crying', color: 'var(--series-1)' },
  { key: 'safety', label: 'Safety', color: 'var(--series-2)' },
  { key: 'camera', label: 'Camera', color: 'var(--series-3)' },
] as const;

export interface DayAlerts {
  day: string;
  sound: number;
  safety: number;
  camera: number;
}

const axis = { stroke: 'var(--text-muted)', fontSize: 12, tickLine: false, axisLine: false } as const;

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="tabular flex items-center gap-2 text-ink">
          {r.color && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} aria-hidden />}
          <span className="text-muted">{r.label}</span>
          <span className="ml-auto font-semibold">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Alerts and warnings per day, stacked by group. */
export function AlertsByDay({ data }: { data: DayAlerts[] }) {
  const [table, setTable] = useState(false);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <ul className="flex flex-wrap gap-4 text-sm" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-muted">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        <button className="ml-auto text-sm text-muted underline" onClick={() => setTable((t) => !t)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <table className="tabular w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 font-medium">Day</th>
              {SERIES.map((s) => (
                <th key={s.key} className="py-1 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="py-1">{d.day}</td>
                {SERIES.map((s) => (
                  <td key={s.key} className="py-1 text-right">
                    {d[s.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="day" {...axis} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} {...axis} />
              <Tooltip
                cursor={{ fill: 'var(--surface-alt)' }}
                content={(p: TooltipContentProps) =>
                  p.active && p.payload?.length ? (
                    <TooltipBox
                      title={String(p.label)}
                      rows={SERIES.map((s) => ({ label: s.label, value: String((p.payload?.[0]?.payload as DayAlerts)[s.key]), color: s.color }))}
                    />
                  ) : null
                }
              />
              {SERIES.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="a"
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  maxBarSize={28}
                  radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** One measure per night, as a single-series bar chart. */
export function NightBars({ data, unit, format }: { data: { day: string; value: number }[]; unit: string; format?: (v: number) => string }) {
  const fmt = format ?? ((v: number) => `${v}`);
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" {...axis} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} {...axis} />
          <Tooltip
            cursor={{ fill: 'var(--surface-alt)' }}
            content={(p: TooltipContentProps) =>
              p.active && p.payload?.length ? <TooltipBox title={String(p.label)} rows={[{ label: unit, value: fmt(Number(p.payload[0].value)) }]} /> : null
            }
          />
          <Bar dataKey="value" fill="var(--series-1)" maxBarSize={28} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
