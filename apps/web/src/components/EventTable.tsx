'use client';

import { eventTitle } from '@lulu/core';

import { supabase, type EventRow } from '@/lib/supabase';

import { Pill, severityTone } from './ui';

export function EventTable({ events, cameraNames, onChange }: { events: EventRow[]; cameraNames: Record<string, string>; onChange?: () => void }) {
  if (!events.length) return <p className="text-sm text-muted">Nothing to show.</p>;
  const ack = async (id: string) => {
    await supabase.rpc('acknowledge_event', { p_event: id });
    onChange?.();
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 pr-4 font-medium">What</th>
            <th className="py-2 pr-4 font-medium">Details</th>
            <th className="py-2 pr-4 font-medium">Camera</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t border-line align-top">
              <td className="tabular whitespace-nowrap py-2 pr-4 text-muted">
                {new Date(e.occurred_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </td>
              <td className="py-2 pr-4">
                <Pill tone={severityTone(e.severity)}>{eventTitle(e.type)}</Pill>
              </td>
              <td className="py-2 pr-4">{e.message}</td>
              <td className="whitespace-nowrap py-2 pr-4 text-muted">{e.camera_id ? cameraNames[e.camera_id] : ''}</td>
              <td className="whitespace-nowrap py-2 text-right">
                {e.severity === 'alert' &&
                  (e.acknowledged_at ? (
                    <span className="text-xs text-muted">Seen</span>
                  ) : (
                    <button className="text-xs font-semibold text-accent" onClick={() => ack(e.id)}>
                      Mark seen
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
