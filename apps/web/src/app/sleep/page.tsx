'use client';

import { formatClock, summarizeNight } from '@lulu/core';
import { useMemo } from 'react';

import { NightBars } from '@/components/Charts';
import { Card, Label } from '@/components/ui';
import { useEvents, useLulu } from '@/lib/lulu';

const NIGHTS = 14;

export default function SleepLog() {
  const { householdId } = useLulu();
  const { events, loading } = useEvents(householdId, NIGHTS + 1);

  const nights = useMemo(() => {
    const stored = events.map((e) => ({ type: e.type, occurredAt: e.occurred_at, data: e.data }));
    const out = [];
    const today = new Date();
    if (today.getHours() < 18) today.setDate(today.getDate() - 1);
    for (let i = 0; i < NIGHTS; i++) {
      const evening = new Date(today);
      evening.setDate(today.getDate() - i);
      out.push({ evening, summary: summarizeNight(stored, evening) });
    }
    return out;
  }, [events]);

  const label = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const chronological = [...nights].reverse();
  const hours = chronological.map((n) => ({ day: label(n.evening), value: Math.round((n.summary.sleepMinutes / 60) * 10) / 10 }));
  const wakes = chronological.map((n) => ({ day: label(n.evening), value: n.summary.wakeUps.length }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sleep log</h1>
        <p className="mt-1 text-muted">Built from event text only (settled, stirring, crying). Nights run 6 pm to 10 am.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Label>Hours asleep per night</Label>
          <div className="mt-4">
            <NightBars data={hours} unit="Asleep" format={(v) => `${v} h`} />
          </div>
        </Card>
        <Card>
          <Label>Wake-ups per night</Label>
          <div className="mt-4">
            <NightBars data={wakes} unit="Wake-ups" />
          </div>
        </Card>
      </div>
      {!loading &&
        nights.map(({ evening, summary }) => (
          <Card key={summary.date}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{evening.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              {summary.settledAt && (
                <p className="tabular text-sm text-muted">
                  {formatClock(summary.settledAt)} → {summary.upAt ? formatClock(summary.upAt) : '…'}
                </p>
              )}
            </div>
            <p className="mt-2 leading-relaxed">{summary.text}</p>
          </Card>
        ))}
    </div>
  );
}
