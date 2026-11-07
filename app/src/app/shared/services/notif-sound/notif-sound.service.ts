import { Injectable, inject } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';

type Note = { f: number; to?: number; at: number; dur: number; type?: OscillatorType; vol?: number };

/** Sons da Central (gerados na hora, sem arquivo): o processo principal pede, a tela toca. */
const SOUNDS: Record<string, Note[]> = {
  chime: [{ f: 880, at: 0, dur: 0.18 }, { f: 1320, at: 0.13, dur: 0.32 }],
  drop: [{ f: 1250, to: 420, at: 0, dur: 0.22 }],
  pop: [{ f: 620, at: 0, dur: 0.07, type: 'triangle', vol: 0.5 }],
  bell: [{ f: 660, at: 0, dur: 1.1 }, { f: 1320, at: 0, dur: 0.7, vol: 0.12 }],
};

@Injectable({ providedIn: 'root' })
export class NotifSoundService {
  private ctx: AudioContext | null = null;

  constructor() {
    inject(IpcService).on('notify:sound', s => this.play(String(s)));
  }

  play(name: string): void {
    const notes = SOUNDS[name];
    if (!notes) return;
    this.ctx ??= new AudioContext();
    const t0 = this.ctx.currentTime + 0.02;
    for (const n of notes) {
      const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
      osc.type = n.type ?? 'sine';
      osc.frequency.setValueAtTime(n.f, t0 + n.at);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.at + n.dur);
      gain.gain.setValueAtTime(0.0001, t0 + n.at);
      gain.gain.exponentialRampToValueAtTime(n.vol ?? 0.25, t0 + n.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.05);
    }
  }
}
