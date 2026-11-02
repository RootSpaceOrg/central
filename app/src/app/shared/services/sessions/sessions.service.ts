import { Injectable, computed, inject, signal } from '@angular/core';

import { SessionDto, SessionKind } from '../../contract';
import { ChatService, ChatSession } from '../chat/chat.service';
import { errorMessage } from '../ipc/ipc.service';
import { TerminalsService } from '../terminals/terminals.service';
import { SessionsApiService } from './sessions-api.service';

export type { SessionKind };
export interface Session { id: number; projectSlug: string; kind: SessionKind; title: string; chatId: number | null }
export interface ClaudeSession { id: string; cwd: string; title: string; updatedAt: Date; sizeKb: number; imported: boolean }

/** Tipos de sessão do "+", com o ícone original de cada ferramenta (SVGs do Material Icon Theme em /file-icons). */
export const SESSION_KINDS: { kind: SessionKind; label: string; hint?: string; img: string }[] = [
  { kind: 'chat', label: 'Claude', hint: 'conversa', img: 'file-icons/claude.svg' },
  { kind: 'claude', label: 'Claude Code', hint: 'terminal', img: 'file-icons/claude.svg' },
  { kind: 'shell', label: 'PowerShell', img: 'file-icons/powershell.svg' },
  { kind: 'cmd', label: 'CMD', img: 'file-icons/console.svg' },
  { kind: 'bash', label: 'Git Bash', img: 'file-icons/git.svg' },
];
export const SESSION_IMG = Object.fromEntries(SESSION_KINDS.map(k => [k.kind, k.img])) as Record<SessionKind, string>;

/** aba fixa com explorador + editor */
export const CODE_TAB = 0;

const toSession = (d: SessionDto): Session => ({ id: d.id, projectSlug: d.project_slug, kind: d.kind, title: d.title, chatId: d.chat_id });

/**
 * Sessões (conversas com o Claude e terminais) de todos os projetos, salvas no banco. Aparecem como abas no projeto
 * e como painéis na Grade. Os processos vivem aqui, não na tela.
 */
@Injectable({ providedIn: 'root' })
export class SessionsService {
  private readonly api = inject(SessionsApiService);
  private readonly chat = inject(ChatService);
  private readonly terminals = inject(TerminalsService);
  private readonly chats = new Map<number, ChatSession>();

  readonly all = signal<Session[]>([]);
  readonly loaded = signal(false);
  readonly byId = computed(() => new Map(this.all().map(s => [s.id, s])));
  /** aba ativa por projeto (CODE_TAB = código) */
  readonly active = signal<Record<string, number>>({});
  readonly error = signal<string | null>(null);

  constructor() { this.load(); }

  async load(): Promise<void> {
    this.all.set((await this.api.list()).map(toSession));
    this.loaded.set(true);
  }

  of(slug: string): Session[] { return this.all().filter(s => s.projectSlug === slug); }

  select(slug: string, id: number): void { this.active.update(a => ({ ...a, [slug]: id })); }

  /** Cria a sessão (ou acha a aba que já tem essa conversa). select = vira a aba ativa do projeto. */
  async open(slug: string, kind: SessionKind, chatId: number | null = null, select = true): Promise<Session | null> {
    const open = chatId ? this.all().find(s => s.chatId === chatId) : null;
    if (open) { if (select) this.select(slug, open.id); return open; }
    try {
      const s = toSession(await this.api.create(slug, kind, chatId));
      this.all.update(list => [...list, s]);
      if (select) this.select(slug, s.id);
      this.error.set(null);
      return s;
    } catch (e) {
      this.error.set(errorMessage(e));
      return null;
    }
  }

  /** Sessões do Claude Code no disco (para importar). */
  async claudeSessions(): Promise<ClaudeSession[]> {
    return (await this.api.claudeSessions()).map(d => ({
      id: d.session_id, cwd: d.cwd, title: d.title, updatedAt: new Date(d.updated_at), sizeKb: d.size_kb, imported: d.imported_chat_id !== null,
    }));
  }

  /** Traz uma sessão do Claude Code para o projeto como conversa (com o histórico) e abre a aba. */
  async importClaude(id: string, slug: string): Promise<Session> {
    const s = toSession(await this.api.importClaude(id, slug));
    await this.load();
    this.chat.loadChats();
    this.select(slug, s.id);
    return s;
  }

  async close(s: Session): Promise<void> {
    await this.api.close(s.id);
    this.terminals.stop(s.id);
    const c = this.chats.get(s.id);
    if (c) { this.chat.release(c); this.chats.delete(s.id); }
    this.all.update(list => list.filter(x => x.id !== s.id));
    if (this.active()[s.projectSlug] === s.id) this.select(s.projectSlug, this.of(s.projectSlug).at(-1)?.id ?? CODE_TAB);
  }

  async rename(s: Session, title: string): Promise<void> {
    await this.api.update(s.id, { title });
    await this.load();
  }

  /** Conversa da sessão: criada na primeira vez; a primeira mensagem dá o id e o título. Chame fora do template. */
  chatOf(s: Session): ChatSession {
    let c = this.chats.get(s.id);
    if (!c) {
      c = this.chat.spawn(s.projectSlug);
      if (s.chatId) c.select(s.chatId);
      c.onCreated = async id => { await this.api.update(s.id, { chat_id: id }); this.load(); };
      this.chats.set(s.id, c);
    }
    return c;
  }
}
