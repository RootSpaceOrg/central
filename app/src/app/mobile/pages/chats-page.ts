import { Component, DestroyRef, computed, effect, inject, input, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ChatView } from '../../shared/components/chat-view/chat-view';
import { AgentsService } from '../../shared/services/agents/agents.service';
import { ChatService } from '../../shared/services/chat/chat.service';
import { AgoPipe } from '../../shared/ui/ago.pipe';
import { Icon } from '../../shared/ui/icon';
import { ProjectAvatar } from '../../shared/ui/project-avatar';
import { MobileScope, ScopePicker } from '../scope';

/** Conversas no celular: as recentes e os agentes para começar uma nova */
@Component({
  selector: 'app-mobile-chats',
  imports: [AgoPipe, ProjectAvatar, RouterLink, ScopePicker],
  host: { class: 'block px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8' },
  template: `
    <h1 class="font-display text-[24px] font-bold">Conversas</h1>
    <div class="mt-2"><app-scope-picker /></div>
    <h2 class="mt-5 text-[11.5px] font-bold uppercase tracking-wider text-faint">Recentes</h2>
    <ul class="mt-2 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-panel">
      @for (c of recent(); track c.id) {
        <li><a [routerLink]="['/conversas', c.id]" class="flex items-center gap-3 px-4 py-3 active:bg-raise">
          @if (agent(c.agentId); as a) { <app-project-avatar [project]="$any(a)" [size]="30" /> }
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold">{{ c.title }}</span>
            <span class="block truncate text-[12px] text-mute">{{ agent(c.agentId)?.name ?? 'Agente' }} · {{ c.updatedAt | ago }}</span>
          </span>
          @if (chat.busy().has(c.id)) { <span class="pulse size-2 shrink-0 rounded-full bg-yes" title="respondendo"></span> }
        </a></li>
      } @empty { <li class="px-4 py-6 text-center text-[13px] text-mute">Nenhuma conversa ainda.</li> }
    </ul>
    <h2 class="mt-6 text-[11.5px] font-bold uppercase tracking-wider text-faint">Começar com</h2>
    <div class="mt-2 grid grid-cols-2 gap-2">
      @for (a of agentsList(); track a.id) {
        <a [routerLink]="['/conversas', 'novo', a.id]" class="flex items-center gap-2 rounded-xl border border-edge bg-panel px-3 py-2.5 active:bg-raise">
          <app-project-avatar [project]="$any(a)" [size]="24" /><span class="min-w-0 truncate text-[13px] font-semibold">{{ a.name }}</span></a>
      }
    </div>`,
})
export class ChatsPage {
  protected readonly chat = inject(ChatService);
  private readonly agents = inject(AgentsService);
  private readonly scope = inject(MobileScope);
  protected readonly recent = computed(() => this.chat.chats().filter(c => this.scope.matches(c.projectSlug ?? this.agent(c.agentId)?.projectSlug)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 25));
  protected readonly agentsList = computed(() => this.agents.agents().filter(a => !a.projectSlug || this.scope.matches(a.projectSlug)).sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name)));
  protected agent(id: number) { return this.agents.byId().get(id) ?? null; }
  constructor() { this.chat.loadChats(); }
}

/** uma conversa (a mesma tela de chat do PC), ou uma nova com o agente escolhido */
@Component({
  selector: 'app-mobile-chat',
  imports: [ChatView, Icon, ProjectAvatar, RouterLink],
  host: { class: 'flex h-full flex-col' },
  template: `
    <header class="flex shrink-0 items-center gap-3 border-b border-edge bg-panel px-3 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <a routerLink="/conversas" class="grid size-9 place-items-center rounded-full text-mute active:bg-raise" aria-label="Voltar"><app-icon name="back" [size]="18" /></a>
      @if (session.agent(); as a) { <app-project-avatar [project]="$any(a)" [size]="30" /> }
      <div class="min-w-0 flex-1 leading-tight">
        <p class="truncate font-semibold">{{ session.agent()?.name ?? 'Central' }}</p>
        <p class="truncate text-[12px] text-faint">{{ title() }}</p>
      </div>
    </header>
    <app-chat-view class="min-h-0 flex-1" [compact]="true" [session]="session" />`,
})
export class ChatPage {
  readonly id = input<string>('');
  readonly agentId = input<string>('');
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);
  protected readonly session = this.chat.spawn(null);
  protected readonly title = computed(() => this.chat.chats().find(c => c.id === this.session.current())?.title ?? 'Conversa nova');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.chat.release(this.session));
    // conversa nova ganhou id: a rota passa a apontar para ela
    this.session.onCreated = id => this.router.navigate(['/conversas', id], { replaceUrl: true });
    effect(() => {
      const id = Number(this.id()), agent = Number(this.agentId());
      untracked(() => {
        if (agent) { this.session.newChat(agent); return; }
        const c = this.chat.chats().find(x => x.id === id);
        if (c) this.session.agentId.set(c.agentId);
        if (this.session.current() !== id) this.session.select(id);
      });
    });
    // a lista de conversas chega depois: acerta o agente da conversa aberta
    effect(() => { const c = this.chat.chats().find(x => x.id === this.session.current()); if (c) untracked(() => this.session.agentId.set(c.agentId)); });
  }
}
