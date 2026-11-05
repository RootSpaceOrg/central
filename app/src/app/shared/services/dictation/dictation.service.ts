import { Injectable, computed, inject, signal } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';
import { SettingsApiService } from '../settings/settings-api.service';

/** Gravação em andamento: parar devolve o áudio. */
export interface Recording { stop(): Promise<Blob>; cancel(): void }

/**
 * Ditado nos chats: grava pelo microfone e transcreve pela extensão Transcrição (motor local ou OpenAI).
 * Só aparece com a extensão pronta e o ditado ligado (Extensões → Transcrição).
 */
@Injectable({ providedIn: 'root' })
export class DictationService {
  private readonly ipc = inject(IpcService);
  private readonly settings = inject(SettingsApiService);

  private readonly engineReady = signal(false);
  readonly enabled = signal(true);
  readonly ready = computed(() => this.engineReady() && this.enabled());

  constructor() {
    this.refresh();
    this.ipc.on('ext:changed', () => this.refresh());
    this.settings.get('stt:dictation').then(v => this.enabled.set(v !== '0'));
  }

  private refresh(): void {
    this.ipc.invoke('stt:status').then(s => this.engineReady.set(!!s.installed && !!s.ready), () => this.engineReady.set(false));
  }

  setEnabled(on: boolean): void { this.enabled.set(on); this.settings.set('stt:dictation', on ? '1' : '0'); }

  async record(): Promise<Recording> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const done = new Promise<Blob>(resolve => { rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); resolve(new Blob(chunks, { type: 'audio/webm' })); }; });
    rec.start();
    return {
      stop: () => { if (rec.state !== 'inactive') rec.stop(); return done; },
      cancel: () => { if (rec.state !== 'inactive') rec.stop(); },
    };
  }

  async transcribe(audio: Blob): Promise<string> {
    return this.ipc.invoke('stt:dictate', new Uint8Array(await audio.arrayBuffer()));
  }
}
