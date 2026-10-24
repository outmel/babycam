/**
 * Live view over WebRTC. Video and audio go peer to peer between the camera phone and the
 * viewer, encrypted end to end with DTLS-SRTP. Supabase Realtime only relays the small
 * signaling messages (offer/answer/ICE) on a private channel that only owners and caregivers
 * of the household can join (see `can_live` in the migration).
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  MediaStream,
  mediaDevices,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';

import { supabase } from './supabase';

type Signal =
  | { kind: 'offer'; viewerId: string; sdp: { type: string; sdp: string } }
  | { kind: 'answer'; viewerId: string; sdp: { type: string; sdp: string } }
  | { kind: 'ice'; viewerId: string; from: 'viewer' | 'camera'; candidate: unknown }
  | { kind: 'ping'; viewerId: string }
  | { kind: 'leave'; viewerId: string }
  | { kind: 'busy'; viewerId: string; reason: string };

const MAX_VIEWERS = 3;
const VIEWER_TIMEOUT_MS = 30_000;

export function iceServers(): { urls: string | string[]; username?: string; credential?: string }[] {
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turn = process.env.EXPO_PUBLIC_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn,
      username: process.env.EXPO_PUBLIC_TURN_USERNAME,
      credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

async function openChannel(cameraId: string, onSignal: (s: Signal) => void): Promise<RealtimeChannel> {
  await supabase.realtime.setAuth();
  const channel = supabase.channel(`live:${cameraId}`, { config: { private: true, broadcast: { self: false } } });
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload as Signal));
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(`Live channel ${status}`));
    });
  });
  return channel;
}

function send(channel: RealtimeChannel | null, payload: Signal) {
  void channel?.send({ type: 'broadcast', event: 'signal', payload });
}

// ---------------------------------------------------------------------------
// Camera side
// ---------------------------------------------------------------------------

interface ViewerPeer {
  pc: RTCPeerConnection;
  lastSeen: number;
  pendingIce: unknown[];
  remoteSet: boolean;
}

export interface LiveHostHooks {
  /** Release the analysis camera and mic. Resolves once they're free. */
  pauseAnalysis: () => Promise<void>;
  /** Called when the last viewer leaves. */
  resumeAnalysis: () => void;
  position: () => 'back' | 'front';
  onViewersChanged?: (count: number) => void;
}

export class LiveHost {
  private channel: RealtimeChannel | null = null;
  private viewers = new Map<string, ViewerPeer>();
  private stream: MediaStream | null = null;
  private capturing: Promise<MediaStream> | null = null;
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly cameraId: string,
    private readonly hooks: LiveHostHooks,
  ) {}

  async start(): Promise<void> {
    this.channel = await openChannel(this.cameraId, (s) => void this.onSignal(s));
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const [id, v] of this.viewers) if (now - v.lastSeen > VIEWER_TIMEOUT_MS) this.removeViewer(id);
    }, 10_000);
  }

  stop(): void {
    if (this.sweep) clearInterval(this.sweep);
    for (const id of [...this.viewers.keys()]) this.removeViewer(id);
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  private async onSignal(s: Signal): Promise<void> {
    if (s.kind === 'offer') await this.acceptViewer(s.viewerId, s.sdp);
    else if (s.kind === 'ice' && s.from === 'viewer') {
      const v = this.viewers.get(s.viewerId);
      if (!v) return;
      if (v.remoteSet) await v.pc.addIceCandidate(new RTCIceCandidate(s.candidate as never)).catch(() => {});
      else v.pendingIce.push(s.candidate);
    } else if (s.kind === 'ping') {
      const v = this.viewers.get(s.viewerId);
      if (v) v.lastSeen = Date.now();
    } else if (s.kind === 'leave') this.removeViewer(s.viewerId);
  }

  private async capture(): Promise<MediaStream> {
    if (this.stream) return this.stream;
    this.capturing ??= (async () => {
      await this.hooks.pauseAnalysis();
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: this.hooks.position() === 'front' ? 'user' : 'environment',
          width: 1280,
          height: 720,
          frameRate: 15,
        },
      });
      this.stream = stream;
      return stream;
    })();
    try {
      return await this.capturing;
    } finally {
      this.capturing = null;
    }
  }

  private async acceptViewer(viewerId: string, sdp: { type: string; sdp: string }): Promise<void> {
    if (this.viewers.has(viewerId)) this.removeViewer(viewerId);
    if (this.viewers.size >= MAX_VIEWERS) {
      send(this.channel, { kind: 'busy', viewerId, reason: `Up to ${MAX_VIEWERS} people can watch at once.` });
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const peer: ViewerPeer = { pc, lastSeen: Date.now(), pendingIce: [], remoteSet: false };
    this.viewers.set(viewerId, peer);
    this.hooks.onViewersChanged?.(this.viewers.size);

    pc.addEventListener('icecandidate', (e) => {
      if (e.candidate) send(this.channel, { kind: 'ice', viewerId, from: 'camera', candidate: e.candidate.toJSON() });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.removeViewer(viewerId);
    });

    try {
      const stream = await this.capture();
      if (!this.viewers.has(viewerId)) return; // left while we were starting the camera
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(sdp as never));
      peer.remoteSet = true;
      for (const c of peer.pendingIce) await pc.addIceCandidate(new RTCIceCandidate(c as never)).catch(() => {});
      peer.pendingIce = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send(this.channel, { kind: 'answer', viewerId, sdp: { type: answer.type, sdp: answer.sdp } });
    } catch (e) {
      send(this.channel, { kind: 'busy', viewerId, reason: e instanceof Error ? e.message : 'Camera unavailable' });
      this.removeViewer(viewerId);
    }
  }

  private removeViewer(viewerId: string): void {
    const v = this.viewers.get(viewerId);
    if (!v) return;
    this.viewers.delete(viewerId);
    v.pc.close();
    this.hooks.onViewersChanged?.(this.viewers.size);
    if (this.viewers.size === 0 && this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream.release?.();
      this.stream = null;
      this.hooks.resumeAnalysis();
    }
  }
}

// ---------------------------------------------------------------------------
// Viewer side
// ---------------------------------------------------------------------------

export type ViewerState = 'connecting' | 'live' | 'failed' | 'ended';

export class LiveViewer {
  readonly viewerId = `v-${Math.random().toString(36).slice(2, 10)}`;
  private channel: RealtimeChannel | null = null;
  private pc: RTCPeerConnection | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private pendingIce: unknown[] = [];
  private remoteSet = false;

  constructor(
    private readonly cameraId: string,
    private readonly onState: (state: ViewerState, detail?: { stream?: MediaStream; error?: string }) => void,
  ) {}

  async start(): Promise<void> {
    this.onState('connecting');
    try {
      this.channel = await openChannel(this.cameraId, (s) => void this.onSignal(s));
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      this.pc = pc;
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addEventListener('track', (e) => {
        const stream = e.streams?.[0];
        if (stream) this.onState('live', { stream });
      });
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) send(this.channel, { kind: 'ice', viewerId: this.viewerId, from: 'viewer', candidate: e.candidate.toJSON() });
      });
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') this.fail('Connection lost. Both phones need internet access.');
      });
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      send(this.channel, { kind: 'offer', viewerId: this.viewerId, sdp: { type: offer.type, sdp: offer.sdp } });
      this.ping = setInterval(() => send(this.channel, { kind: 'ping', viewerId: this.viewerId }), 10_000);
      this.timeout = setTimeout(() => {
        if (!this.remoteSet) this.fail('The camera did not answer. Is Lulu open on the camera phone?');
      }, 20_000);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  stop(): void {
    send(this.channel, { kind: 'leave', viewerId: this.viewerId });
    this.cleanup();
    this.onState('ended');
  }

  private async onSignal(s: Signal): Promise<void> {
    if (s.viewerId !== this.viewerId || !this.pc) return;
    if (s.kind === 'answer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(s.sdp as never));
      this.remoteSet = true;
      for (const c of this.pendingIce) await this.pc.addIceCandidate(new RTCIceCandidate(c as never)).catch(() => {});
      this.pendingIce = [];
    } else if (s.kind === 'ice' && s.from === 'camera') {
      if (this.remoteSet) await this.pc.addIceCandidate(new RTCIceCandidate(s.candidate as never)).catch(() => {});
      else this.pendingIce.push(s.candidate);
    } else if (s.kind === 'busy') {
      this.fail(s.reason);
    }
  }

  private fail(error: string): void {
    this.cleanup();
    this.onState('failed', { error });
  }

  private cleanup(): void {
    if (this.ping) clearInterval(this.ping);
    if (this.timeout) clearTimeout(this.timeout);
    this.pc?.close();
    this.pc = null;
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
  }
}
