import { Injectable, inject, signal } from '@angular/core';

import { MeetingDto } from '../../../../shared/contract';
import { IpcService, errorMessage } from '../../../../shared/services/ipc/ipc.service';

export interface Meeting {
  id: number; title: string; projectSlug: string | null; screen: boolean;
  status: MeetingDto['status']; startedAt: Date; endedAt: Date | null; duration: number | null;
  transcript: string | null; chatId: number | null; error: string | null; frames: number; path: string;
  /** áudio/vídeo para o player */
  media: string;
}

const utc = (s: string) => new Date(s.endsWith('Z') ? s : `${s}Z`);
const toMeeting = (d: MeetingDto): Meeting => ({
  id: d.id, title: d.title, projectSlug: d.project_slug, screen: !!d.screen, status: d.status, startedAt: utc(d.started_at),
  endedAt: d.ended_at ? utc(d.ended_at) : null, duration: d.duration, transcript: d.transcript, chatId: d.chat_id, error: d.error,
  frames: d.frames, path: d.path, media: `central-media://m/${d.id}`,
});

/** as reuniões gravadas: lista, conversar sobre uma, renomear, ligar a um projeto */
@Injectable({ providedIn: 'root' })
export class MeetingsService {
  private readonly ipc = inject(IpcService);
  readonly list = signal<Meeting[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    this.ipc.on('meetings:changed', () => this.load());
    this.load();
  }

  load(): void { this.ipc.invoke('meetings:list').then(l => this.list.set(l.map(toMeeting)), () => {}); }

  /** pede algo sobre a reunião (a primeira vez abre a conversa com o contexto); devolve a conversa */
  async ask(id: number, text: string, agentId: number | null = null): Promise<number | null> {
    this.error.set(null);
    try { const chat = await this.ipc.invoke('meetings:ask', id, text, agentId); this.load(); return chat; }
    catch (e) { this.error.set(errorMessage(e)); return null; }
  }
  update(id: number, patch: { title?: string; project_slug?: string | null }) { return this.ipc.invoke('meetings:update', id, patch); }
  remove(id: number) { return this.ipc.invoke('meetings:delete', id); }
  transcribe(id: number) { return this.ipc.invoke('meetings:transcribe', id); }
  openFolder(id: number) { return this.ipc.invoke('meetings:open', id); }
}
