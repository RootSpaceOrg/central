import { Injectable, computed, inject, signal } from '@angular/core';

import { ChatDto, ChatMessageDto, ChatRole } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { ChatApiService } from './chat-api.service';

export interface Chat { id: number; title: string; updatedAt: Date }
export interface ChatMessage { id: number; role: ChatRole; text: string; at: Date }

const toChat = (d: ChatDto): Chat => ({ id: d.id, title: d.title, updatedAt: new Date(d.updated_at) });
const toMessage = (d: ChatMessageDto): ChatMessage => ({ id: d.id, role: d.role, text: d.text, at: new Date(d.at) });

/** Conversas com o agente Central. O painel abre de qualquer tela (Ctrl+J). */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = inject(ChatApiService);

  readonly open = signal(false);
  readonly chats = signal<Chat[]>([]);
  readonly current = signal<number | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly busy = signal<Set<number>>(new Set());
  readonly error = signal<string | null>(null);
  readonly currentBusy = computed(() => this.current() !== null && this.busy().has(this.current()!));

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
    this.api.list().then(list => this.chats.set(list.map(toChat)));
  }

  select(chatId: number | null): void {
    this.current.set(chatId);
    this.messages.set([]);
    if (chatId) this.api.messages(chatId).then(list => { if (this.current() === chatId) this.messages.set(list.map(toMessage)); });
  }

  async send(text: string): Promise<void> {
    this.error.set(null);
    try {
      const id = await this.api.send(this.current(), text);
      if (this.current() !== id) this.select(id);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  stop(): void {
    const id = this.current();
    if (id) this.api.stop(id);
  }

  async remove(chatId: number): Promise<void> {
    await this.api.remove(chatId);
    if (this.current() === chatId) this.select(null);
    this.loadChats();
  }
}
