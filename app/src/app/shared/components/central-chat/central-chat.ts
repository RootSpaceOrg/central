import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ChatService } from '../../services/chat/chat.service';
import { AgentsService } from '../../services/agents/agents.service';
import { AgoPipe } from '../../ui/ago.pipe';
import { Icon } from '../../ui/icon';
import { ChatView } from '../chat-view/chat-view';
import { ProjectAvatar } from '../../ui/project-avatar';

/** Painel lateral (Ctrl+J): o chefe de gabinete (sempre a Central), de qualquer tela. No cockpit ele já mora na coluna. */
@Component({
  selector: 'app-central-chat',
  imports: [Icon, AgoPipe, ChatView, ProjectAvatar],
  host: { '(document:keydown.control.j)': 'toggle(); $event.preventDefault()', '(document:keydown.escape)': 'escape()' },
  templateUrl: './central-chat.html',
})
export class CentralChat {
  protected readonly chat = inject(ChatService);
  private readonly router = inject(Router);

  protected readonly history = signal(false);
  protected readonly central = computed(() => this.agentsSvc.central());
  private readonly agentsSvc = inject(AgentsService);

  constructor() { this.chat.restoreChief(); }

  protected toggle(): void { this.chat.toggle(); }

  protected newChat(): void { this.chat.chief.newChat(this.central()?.id); this.history.set(false); }
  protected pick(id: number): void { this.chat.chief.select(id); this.history.set(false); }

  protected expand(): void {
    this.chat.open.set(false);
    this.router.navigate(['/agentes'], { queryParams: { agente: this.central()?.id, conversa: this.chat.chief.current() ?? undefined } });
  }

  protected escape(): void {
    if (this.chat.open() && !document.querySelector('dialog[open]')) this.chat.open.set(false);
  }
}
