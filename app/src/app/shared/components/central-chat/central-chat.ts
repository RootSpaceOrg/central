import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';

import { ChatService } from '../../services/chat/chat.service';
import { AgoPipe } from '../../ui/ago.pipe';
import { Icon } from '../../ui/icon';
import { MdLitePipe } from '../../ui/md-lite.pipe';

const SUGGESTIONS = [
  'O que está pendente hoje, em todos os projetos?',
  'Organize o backlog do KultivAi por prioridade.',
  'Crie uma rotina que toda manhã revisa os PRs abertos e cria decisões.',
  'Quais projetos estão parados há mais de duas semanas?',
];

/** Painel do agente Central: conversa que lê e mexe em tudo pela Central. */
@Component({
  selector: 'app-central-chat',
  imports: [Icon, MdLitePipe, AgoPipe],
  host: { '(document:keydown.control.j)': 'chat.toggle(); $event.preventDefault()', '(document:keydown.escape)': 'escape()' },
  templateUrl: './central-chat.html',
})
export class CentralChat {
  protected readonly chat = inject(ChatService);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  protected readonly suggestions = SUGGESTIONS;
  protected readonly text = signal('');
  protected readonly history = signal(false);

  constructor() {
    effect(() => {
      this.chat.messages();
      this.chat.currentBusy();
      const el = this.list()?.nativeElement;
      if (el) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    });
    effect(() => { if (this.chat.open()) queueMicrotask(() => this.input()?.nativeElement.focus()); });
  }

  protected send(text = this.text()): void {
    if (!text.trim() || this.chat.currentBusy()) return;
    this.chat.send(text.trim());
    this.text.set('');
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
  }

  protected newChat(): void { this.chat.select(null); this.history.set(false); }

  protected pick(id: number): void { this.chat.select(id); this.history.set(false); }

  protected escape(): void {
    if (this.chat.open() && !document.querySelector('dialog[open]')) this.chat.open.set(false);
  }
}
