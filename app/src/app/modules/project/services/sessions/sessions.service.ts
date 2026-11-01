import { Injectable, inject, signal } from '@angular/core';

import { SessionDto, SessionKind } from '../../../../shared/contract';
import { ChatService, ChatSession } from '../../../../shared/services/chat/chat.service';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { TerminalsService } from '../terminals/terminals.service';
import { SessionsApiService } from './sessions-api.service';

export interface Session { id: number; projectSlug: string; kind: SessionKind; title: string; chatId: number | null }

/** aba fixa com explorador + editor */
export const CODE_TAB = 0;

const toSession = (d: SessionDto): Session => ({ id: d.id, projectSlug: d.project_slug, kind: d.kind, title: d.title, chatId: d.chat_id });

/** Abas de sessão de cada projeto (conversas com o Claude e terminais), salvas no banco. Os processos vivem aqui, não na tela. */
@Injectable({ providedIn: 'root' })
export class SessionsService {
  private readonly api = inject(SessionsApiService);
  private readonly chat = inject(ChatService);
  private readonly terminals = inject(TerminalsService);
  private readonly chats = new Map<number, ChatSession>();

  readonly bySlug = signal<Record<string, Session[]>>({});
  /** aba ativa por projeto (CODE_TAB = código) */
  readonly active = signal<Record<string, number>>({});
  readonly error = signal<string | null>(null);

  async load(slug: string): Promise<void> {
    const list = (await this.api.list(slug)).map(toSession);
    this.bySlug.update(m => ({ ...m, [slug]: list }));
    if (this.active()[slug] === undefined) this.select(slug, list.at(-1)?.id ?? CODE_TAB);
  }

  of(slug: string): Session[] { return this.bySlug()[slug] ?? []; }

  select(slug: string, id: number): void { this.active.update(a => ({ ...a, [slug]: id })); }

  async open(slug: string, kind: SessionKind, chatId: number | null = null): Promise<void> {
    // conversa antiga que já está numa aba: só vai até ela
    const open = chatId ? this.of(slug).find(s => s.chatId === chatId) : null;
    if (open) return this.select(slug, open.id);
    try {
      const s = toSession(await this.api.create(slug, kind, chatId));
      this.bySlug.update(m => ({ ...m, [slug]: [...(m[slug] ?? []), s] }));
      this.select(slug, s.id);
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async close(s: Session): Promise<void> {
    await this.api.close(s.id);
    this.terminals.stop(s.id);
    const c = this.chats.get(s.id);
    if (c) { this.chat.release(c); this.chats.delete(s.id); }
    const list = this.of(s.projectSlug).filter(x => x.id !== s.id);
    this.bySlug.update(m => ({ ...m, [s.projectSlug]: list }));
    if (this.active()[s.projectSlug] === s.id) this.select(s.projectSlug, list.at(-1)?.id ?? CODE_TAB);
  }

  async rename(s: Session, title: string): Promise<void> {
    await this.api.update(s.id, { title });
    await this.load(s.projectSlug);
  }

  /** Conversa da aba: criada na primeira vez; a primeira mensagem dá o id e o título da aba. */
  chatOf(s: Session): ChatSession {
    let c = this.chats.get(s.id);
    if (!c) {
      c = this.chat.spawn(s.projectSlug);
      if (s.chatId) c.select(s.chatId);
      c.onCreated = async id => { await this.api.update(s.id, { chat_id: id }); this.load(s.projectSlug); };
      this.chats.set(s.id, c);
    }
    return c;
  }
}
