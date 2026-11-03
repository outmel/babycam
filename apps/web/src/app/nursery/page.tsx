'use client';

import { useState } from 'react';

import { Button, Card, Label, Pill } from '@/components/ui';
import { ZoneEditor } from '@/components/ZoneEditor';
import { timeAgo, useCameras, useLulu } from '@/lib/lulu';
import { supabase, type CameraRow } from '@/lib/supabase';

const FIELD = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm';

function CameraCard({ camera, canEdit, isOwner }: { camera: CameraRow; canEdit: boolean; isOwner: boolean }) {
  const [name, setName] = useState(camera.name);
  const [mount, setMount] = useState(camera.settings.mount ?? 'overhead');
  const [position, setPosition] = useState(camera.settings.position ?? 'back');
  const [zones, setZones] = useState(camera.zones);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== camera.name ||
    mount !== (camera.settings.mount ?? 'overhead') ||
    position !== (camera.settings.position ?? 'back') ||
    zones.length !== camera.zones.length;

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setSaved(false);
  };

  const save = async () => {
    setError(null);
    // Keep any other settings the phone wrote; only touch the ones edited here.
    const { error } = await supabase
      .from('cameras')
      .update({ name: name.trim(), settings: { ...camera.settings, mount, position }, zones })
      .eq('id', camera.id);
    if (error) setError(error.message);
    else setSaved(true);
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${camera.name}? Its past alerts stay in History.`)) return;
    const { error } = await supabase.from('cameras').delete().eq('id', camera.id);
    if (error) setError(error.message);
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{camera.name}</h2>
        <Pill tone={camera.online ? 'ok' : 'muted'}>{camera.online ? 'Online' : `Seen ${timeAgo(camera.last_seen_at)}`}</Pill>
      </div>

      <label className="flex flex-col gap-1.5">
        <Label>Name</Label>
        <input className={FIELD} value={name} disabled={!canEdit} onChange={(e) => edit(setName)(e.target.value)} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <Label>Camera angle</Label>
          <select className={FIELD} value={mount} disabled={!canEdit} onChange={(e) => edit(setMount)(e.target.value)}>
            <option value="overhead">Looking down</option>
            <option value="side">From the side</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <Label>Lens</Label>
          <select className={FIELD} value={position} disabled={!canEdit} onChange={(e) => edit(setPosition)(e.target.value)}>
            <option value="back">Back (better)</option>
            <option value="front">Front</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Safe zones</Label>
        {zones.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {zones.map((z) => (
              <li key={z.id} className="flex items-center gap-3 py-2">
                <span>{z.name}</span>
                {canEdit && (
                  <button className="ml-auto text-xs font-semibold text-accent" onClick={() => edit(setZones)(zones.filter((x) => x.id !== z.id))}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && <ZoneEditor zones={zones} onAdd={(z) => edit(setZones)([...zones, z])} />}
        <p className="text-xs text-muted">Zones are saved with Save changes. You can also redraw them on the camera phone with its live picture.</p>
      </div>

      {error && <p className="text-sm text-alert">{error}</p>}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={!dirty || !name.trim()}>
            Save changes
          </Button>
          {saved && <span className="text-sm text-ok">Saved</span>}
          {isOwner && (
            <button className="ml-auto text-sm font-semibold text-alert" onClick={remove}>
              Delete camera
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function Nursery() {
  const { householdId, membership } = useLulu();
  const cameras = useCameras(householdId);
  const canEdit = membership?.role === 'owner' || membership?.role === 'caregiver';
  const [name, setName] = useState('Nursery');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    const { error } = await supabase.from('cameras').insert({ household_id: householdId, name: name.trim(), settings: { mount: 'overhead', position: 'back' } });
    if (error) setError(error.message);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Nursery</h1>
      {cameras.length === 0 && <p className="text-muted">No cameras yet. Add one here, then open Lulu on the spare phone, choose Camera and pick it.</p>}
      {cameras.map((c) => (
        // Remount when the saved row changes so the form picks up edits made on another device.
        <CameraCard key={`${c.id}:${c.name}:${JSON.stringify(c.settings)}:${c.zones.length}`} camera={c} canEdit={canEdit} isOwner={membership?.role === 'owner'} />
      ))}
      {canEdit && (
        <Card className="flex flex-col gap-3">
          <Label>Add a camera</Label>
          <div className="flex flex-wrap gap-3">
            <input className={`${FIELD} flex-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nursery" />
            <Button onClick={add} disabled={!name.trim()}>
              Add
            </Button>
          </div>
          {error && <p className="text-sm text-alert">{error}</p>}
        </Card>
      )}
    </div>
  );
}
