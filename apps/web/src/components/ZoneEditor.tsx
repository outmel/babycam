'use client';

import { useEffect, useState, type MouseEvent } from 'react';

import { Button } from './ui';

export interface Point {
  x: number;
  y: number;
}
export interface ZoneShape {
  id: string;
  name: string;
  points: unknown[];
}

const asPoints = (z: ZoneShape) => z.points as Point[];
const toSvg = (pts: Point[]) => pts.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');

/**
 * Draws safe zones on a 3:4 frame, the same shape the camera phone analyzes, so the saved
 * 0-1 coordinates line up. A photo from the camera's spot makes it easy to trace the crib.
 */
export function ZoneEditor({ zones, onAdd }: { zones: ZoneShape[]; onAdd: (zone: ZoneShape) => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [name, setName] = useState('crib');

  useEffect(() => () => void (photo && URL.revokeObjectURL(photo)), [photo]);

  const tap = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setDraft((d) => [...d, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }]);
  };

  const add = () => {
    onAdd({ id: `z${Date.now().toString(36)}`, name: name.trim() || 'safe zone', points: draft });
    setDraft([]);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Add a photo taken from where the camera phone sits, then tap the corners of the mattress or mat. Draw it a little larger than the mattress so a child lying near the side doesn&apos;t count as
        &ldquo;at the edge&rdquo;.
      </p>
      <label className="inline-flex w-fit cursor-pointer rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-alt">
        {photo ? 'Change photo' : 'Add a photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPhoto(URL.createObjectURL(f));
          }}
        />
      </label>

      <div
        className="relative mx-auto w-full max-w-sm cursor-crosshair touch-manipulation select-none overflow-hidden rounded-xl border border-line bg-surface-alt"
        style={{ aspectRatio: '3 / 4' }}
        onClick={tap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo && <img src={photo} alt="Camera view" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
        {!photo && <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted">No photo yet. You can still tap to outline a zone.</p>}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          {zones.map((z) => (
            <polygon key={z.id} points={toSvg(asPoints(z))} fill="rgba(63,112,72,0.25)" stroke="#3f7048" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
          ))}
          {draft.length > 1 && <polyline points={toSvg(draft)} fill="rgba(200,85,61,0.2)" stroke="#c8553d" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />}
          {draft.map((p, i) => (
            <circle key={i} cx={p.x * 100} cy={p.y * 100} r="1.4" fill="#c8553d" />
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Zone name"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="crib, play mat…"
        />
        <Button onClick={add} disabled={draft.length < 3}>
          Add zone ({draft.length} points)
        </Button>
        <Button variant="ghost" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length}>
          Undo
        </Button>
      </div>
    </div>
  );
}
