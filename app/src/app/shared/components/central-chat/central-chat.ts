import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AgentsService } from '../../services/agents/agents.service';
import { ChatService } from '../../services/chat/chat.service';
import { AgoPipe } from '../../ui/ago.pipe';
import { Icon } from '../../ui/icon';
import { AgentSelect } from '../pickers/agent-select';
import { ChatView } from '../chat-view/chat-view';

/** Painel lateral (Ctrl+J): conversa rápida com a Central ou com qualquer agente, de qualquer tela. */
@Component({
  selector: 'app-central-chat',
  imports: [Icon, AgoPipe, AgentSelect, ChatView],
  host: { '(document:keydown.control.j)': 'toggle(); $event.preventDefault()', '(document:keydown.escape)': 'escape()' },
  templateUrl: './central-chat.html',
})
export class CentralChat {
  protected readonly chat = inject(ChatService);
  private readonly agents = inject(AgentsService);
  private readonly router = inject(Router);

  protected readonly history = signal(false);
  protected readonly agentValue = computed(() => String(this.chat.agent()?.id ?? ''));

  protected toggle(): void {
    if (!this.chat.open() && !this.chat.agentId() && this.agents.central()) this.chat.selectAgent(this.agents.central()!.id);
    this.chat.toggle();
  }

  protected setAgent(id: string): void {
    if (id) this.chat.selectAgent(Number(id));
    this.history.set(false);
  }

  protected newChat(): void { this.chat.newChat(); this.history.set(false); }
  protected pick(id: number): void { this.chat.select(id); this.history.set(false); }

  protected expand(): void {
    this.chat.open.set(false);
    this.router.navigate(['/agentes'], { queryParams: { agente: this.chat.agent()?.id, conversa: this.chat.current() ?? undefined } });
  }

  protected escape(): void {
    if (this.chat.open() && !document.querySelector('dialog[open]')) this.chat.open.set(false);
  }
}
