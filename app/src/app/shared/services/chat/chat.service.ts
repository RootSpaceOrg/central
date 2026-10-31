import { Injectable, computed, inject, signal } from '@angular/core';

import { ChatDto, ChatMessageDto, ChatRole } from '../../contract';
import { AgentsService } from '../agents/agents.service';
import { errorMessage } from '../ipc/ipc.service';
import { ChatApiService } from './chat-api.service';

export interface Chat { id: number; agentId: number; title: string; updatedAt: Date }
export interface ChatMessage { id: number; role: ChatRole; text: string; at: Date }

/** Mensagens agrupadas para a tela: falas, e os passos (ferramentas) entre elas viram um bloco recolhível. */
export type ChatItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'steps'; id: number; steps: ChatMessage[] };

const toChat = (d: ChatDto): Chat => ({ id: d.id, agentId: d.agent_id, title: d.title, updatedAt: new Date(d.updated_at) });
const toMessage = (d: ChatMessageDto): ChatMessage => ({ id: d.id, role: d.role, text: d.text, at: new Date(d.at) });

/**
 * Conversas com os agentes. Uma conversa "atual" por vez, compartilhada entre o painel (Ctrl+J) e a tela Agentes,
 * para a conversa continuar de onde estava em qualquer lugar.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = inject(ChatApiService);
  private readonly agents = inject(AgentsService);

  readonly open = signal(false);
  readonly chats = signal<Chat[]>([]);
  /** agente da conversa atual (ou da próxima conversa nova) */
  readonly agentId = signal<number | null>(null);
  readonly current = signal<number | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly busy = signal<Set<number>>(new Set());
  readonly error = signal<string | null>(null);

  readonly agent = computed(() => {
    const id = this.agentId();
    return (id ? this.agents.byId().get(id) : null) ?? this.agents.central();
  });
  readonly agentChats = computed(() => this.chats().filter(c => c.agentId === this.agent()?.id));
  readonly currentBusy = computed(() => this.current() !== null && this.busy().has(this.current()!));
  readonly items = computed<ChatItem[]>(() => {
    const out: ChatItem[] = [];
    for (const m of this.messages()) {
      const last = out.at(-1);
      if (m.role === 'tool') {
        if (last?.kind === 'steps') last.steps.push(m);
        else out.push({ kind: 'steps', id: m.id, steps: [m] });
      } else out.push({ kind: 'message', message: m });
    }
    return out;
  });

  constructor() {
    this.api.onEvent(({ chat_id, message, busy }) => {
      this.busy.update(s => { const n = new Set(s); if (busy) n.add(chat_id); else n.delete(chat_id); return n; });
      if (message && chat_id === this.current() && !this.messages().some(m => m.id === message.id)) {
        this.messages.update(list => [...list, toMessage(message)]);
      }
      if (!busy) this.loadChats();
    });
    this.loadChats();
  }

  toggle(): void { this.open.update(o => !o); }

  loadChats(): void {
    this.api.list(null).then(list => this.chats.set(list.map(toChat)));
  }

  /** Muda de agente: mostra a conversa mais recente dele (ou uma nova). */
  selectAgent(agentId: number): void {
    if (this.agentId() === agentId && this.current() && this.chats().find(c => c.id === this.current())?.agentId === agentId) return;
    this.agentId.set(agentId);
    this.select(this.chats().find(c => c.agentId === agentId)?.id ?? null);
  }

  select(chatId: number | null): void {
    this.current.set(chatId);
    this.messages.set([]);
    this.error.set(null);
    if (!chatId) return;
    const chat = this.chats().find(c => c.id === chatId);
    if (chat) this.agentId.set(chat.agentId);
    this.api.messages(chatId).then(list => { if (this.current() === chatId) this.messages.set(list.map(toMessage)); });
  }

  newChat(agentId = this.agent()?.id ?? null): void {
    if (agentId) this.agentId.set(agentId);
    this.select(null);
  }

  async send(text: string): Promise<void> {
    const agent = this.agent();
    if (!agent) return;
    this.error.set(null);
    try {
      const id = await this.api.send(this.current(), agent.id, text);
      if (this.current() !== id) {
        this.current.set(id);
        this.api.messages(id).then(list => { if (this.current() === id) this.messages.set(list.map(toMessage)); });
      }
      this.loadChats();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  /** Continua a sessão de uma execução já terminada. Devolve o id da conversa. */
  async fromRun(runId: number): Promise<number> {
    try {
      const id = await this.api.fromRun(runId);
      await this.api.list(null).then(list => this.chats.set(list.map(toChat)));
      this.select(id);
      return id;
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  stop(): void {
    const id = this.current();
    if (id) this.api.stop(id);
  }

  async rename(chatId: number, title: string): Promise<void> {
    await this.api.rename(chatId, title);
    this.loadChats();
  }

  async remove(chatId: number): Promise<void> {
    await this.api.remove(chatId);
    if (this.current() === chatId) this.select(null);
    this.loadChats();
  }
}
