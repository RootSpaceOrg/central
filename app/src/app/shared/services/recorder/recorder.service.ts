import { Injectable, computed, inject, signal } from '@angular/core';

import { IpcService, errorMessage } from '../ipc/ipc.service';

/** prints da tela: de quanto em quanto tempo olha (miniatura, barato) e quanto precisa mudar para guardar outro */
const FRAME_EVERY_MS = 3000;
const FRAME_DIFF = 4;
/** maior largura do print (texto legível para o agente) */
const FRAME_MAX_W = 2560;
const CHUNK_MS = 4000;

/**
 * Gravador de reunião (vive no app inteiro: trocar de tela não para a gravação). Áudio do sistema (o que a call toca, via
 * loopback do Windows) + microfone, misturados num arquivo; com "tela", grava a tela também (poucos quadros por segundo)
 * e guarda um print quando a tela muda, para os agentes verem o que foi mostrado. Os pedaços vão para o disco a cada 4 s.
 */
@Injectable({ providedIn: 'root' })
export class RecorderService {
  private readonly ipc = inject(IpcService);

  readonly active = signal<{ id: number; title: string; startedAt: number; screen: boolean; mic: boolean } | null>(null);
  readonly error = signal<string | null>(null);
  readonly starting = signal(false);
  private readonly now = signal(Date.now());
  /** "12:34" desde o começo */
  readonly elapsed = computed(() => {
    const a = this.active();
    if (!a) return '';
    const s = Math.max(0, Math.floor((this.now() - a.startedAt) / 1000));
    return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(s >= 3600 ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
  });

  private rec: MediaRecorder | null = null;
  private streams: MediaStream[] = [];
  private ctx: AudioContext | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  /** os pedaços saem em ordem (um de cada vez) */
  private chain: Promise<unknown> = Promise.resolve();

  async start(title: string, projectSlug: string | null, screen: boolean): Promise<number | null> {
    if (this.active() || this.starting()) return null;
    this.error.set(null);
    this.starting.set(true);
    try {
      // a Central entrega a tela principal com o áudio do sistema, sem perguntar (main: setDisplayMediaRequestHandler)
      // a 10 qps (4 deixava o texto borrado); o tamanho fica o da tela (pedir largura/altura acabava reduzindo)
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: screen ? 10 : 1 }, audio: true });
      // "detail": o codificador prioriza nitidez (texto, interface) em vez de movimento
      for (const t of display.getVideoTracks()) t.contentHint = 'detail';
      this.streams.push(display);
      if (!display.getAudioTracks().length) throw new Error('O Windows não entregou o áudio do sistema.');
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
      if (mic) this.streams.push(mic);
      const ctx = new AudioContext();
      this.ctx = ctx;
      const dest = ctx.createMediaStreamDestination();
      for (const s of [display, mic]) if (s?.getAudioTracks().length) ctx.createMediaStreamSource(s).connect(dest);

      const m = await this.ipc.invoke('meetings:start', title, projectSlug, screen);
      const tracks = [...dest.stream.getAudioTracks(), ...(screen ? display.getVideoTracks() : [])];
      const rec = new MediaRecorder(new MediaStream(tracks), {
        mimeType: screen ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp8,opus') : 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128_000, videoBitsPerSecond: 4_000_000,
      });
      rec.ondataavailable = e => {
        if (!e.data.size) return;
        this.chain = this.chain.then(async () => this.ipc.invoke('meetings:chunk', m.id, new Uint8Array(await e.data.arrayBuffer()))).catch(() => {});
      };
      rec.start(CHUNK_MS);
      this.rec = rec;
      const startedAt = Date.now();
      this.active.set({ id: m.id, title: m.title, startedAt, screen, mic: !!mic });
      this.timers.push(setInterval(() => this.now.set(Date.now()), 1000));
      if (screen) this.watchScreen(m.id, display, startedAt);
      return m.id;
    } catch (e) {
      this.cleanup();
      this.error.set(errorMessage(e));
      return null;
    } finally {
      this.starting.set(false);
    }
  }

  async stop(): Promise<void> {
    const a = this.active();
    const rec = this.rec;
    if (!a || !rec) return;
    // último print: como a tela estava no fim (mesmo sem mudar desde o anterior)
    await this.lastLook?.(true);
    await new Promise<void>(resolve => { rec.onstop = () => resolve(); rec.stop(); });
    await this.chain;
    this.cleanup();
    this.active.set(null);
    await this.ipc.invoke('meetings:stop', a.id, (Date.now() - a.startedAt) / 1000);
  }

  /** olhar a tela agora (force = guarda mesmo sem mudança); só existe gravando com tela */
  private lastLook: ((force?: boolean) => Promise<void>) | null = null;

  private cleanup(): void {
    this.lastLook = null;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const s of this.streams) for (const t of s.getTracks()) t.stop();
    this.streams = [];
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.rec = null;
  }

  /** a cada ~12 s compara a tela com a última guardada (miniatura); mudou, guarda um print */
  private watchScreen(id: number, display: MediaStream, startedAt: number): void {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = new MediaStream(display.getVideoTracks());
    video.play().catch(() => {});
    const thumb = document.createElement('canvas');
    thumb.width = 64; thumb.height = 36;
    let last: Uint8ClampedArray | null = null;
    const look = async (force = false): Promise<void> => {
      if (!video.videoWidth) return;
      const t = thumb.getContext('2d', { willReadFrequently: true })!;
      t.drawImage(video, 0, 0, 64, 36);
      const px = t.getImageData(0, 0, 64, 36).data;
      if (last && !force) {
        let diff = 0;
        for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i] - last[i]) + Math.abs(px[i + 1] - last[i + 1]) + Math.abs(px[i + 2] - last[i + 2]);
        if (diff / (64 * 36 * 3) < FRAME_DIFF) return;
      }
      last = px;
      const w = Math.min(FRAME_MAX_W, video.videoWidth), h = Math.round((video.videoHeight / video.videoWidth) * w);
      const full = document.createElement('canvas');
      full.width = w; full.height = h;
      full.getContext('2d')!.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>(r => full.toBlob(r, 'image/png'));
      if (blob) await this.ipc.invoke('meetings:frame', id, (Date.now() - startedAt) / 1000, new Uint8Array(await blob.arrayBuffer()));
    };
    this.lastLook = look;
    // primeiro print assim que a tela aparece; depois, a cada 3 s se mudou
    setTimeout(() => look(), 800);
    this.timers.push(setInterval(() => look(), FRAME_EVERY_MS));
  }
}
