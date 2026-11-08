import { Component, input, output } from '@angular/core';

import { Agent } from '../../services/agents/agents.service';
import { ProjectAvatar } from '../../ui/project-avatar';

export interface AgentListItem {
  agent: Agent;
  /** trabalhando agora */
  live?: boolean;
  /** número à direita (ex.: execuções) */
  count?: number | null;
  /** linha de baixo (ex.: projeto, papel) */
  hint?: string | null;
}

/**
 * Coluna de agentes ao lado dos projetos (telas Agentes e Execuções): rola, mostra o ícone e o nome inteiros,
 * quem está trabalhando e um número. "Todos" opcional no topo.
 */
@Component({
  selector: 'app-agent-list',
  imports: [ProjectAvatar],
  host: { class: 'flex min-h-0 w-60 shrink-0 flex-col border-r border-edge bg-panel/60' },
  template: `
    <h2 class="px-4 pt-4 pb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">{{ title() }}</h2>
    <ul class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" role="listbox" [attr.aria-label]="title()">
      @if (allLabel(); as all) {
        <li>
          <button type="button" role="option" [attr.aria-selected]="selected() === null" (click)="picked.emit(null)"
                  class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13.5px] transition-colors"
                  [class]="selected() === null ? 'bg-frost/15 font-semibold text-text' : 'text-mute hover:bg-raise/60 hover:text-text'">
            <span class="grid size-8 place-items-center rounded-lg bg-edge text-[11px] font-bold text-faint">∗</span>
            <span class="min-w-0 flex-1 truncate">{{ all }}</span>
            @if (total() != null) { <span class="text-[12px] tabular-nums text-faint">{{ total() }}</span> }
          </button>
        </li>
      }
      @for (it of items(); track it.agent.id) {
        <li>
          <button type="button" role="option" [attr.aria-selected]="selected() === it.agent.id" (click)="picked.emit(it.agent.id)"
                  (contextmenu)="menu.emit({ event: $event, agent: it.agent })" [title]="it.agent.description ?? it.agent.name"
                  class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
                  [class]="selected() === it.agent.id ? 'bg-frost/15 text-text' : 'text-mute hover:bg-raise/60 hover:text-text'">
            <span class="relative shrink-0">
              <app-project-avatar [project]="it.agent" [size]="32" />
              @if (it.live) { <span class="pulse absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-panel bg-yes" aria-label="trabalhando"></span> }
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13.5px] font-semibold" [class.text-text]="selected() === it.agent.id">{{ it.agent.name }}</span>
              @if (it.hint) { <span class="block truncate text-[11.5px] text-faint">{{ it.hint }}</span> }
            </span>
            @if (it.count != null) { <span class="text-[12px] tabular-nums text-faint">{{ it.count }}</span> }
          </button>
        </li>
      } @empty {
        <li class="px-2 py-3 text-[13px] text-faint">Nenhum agente aqui.</li>
      }
    </ul>
  `,
})
export class AgentList {
  readonly title = input('Agentes');
  readonly items = input.required<AgentListItem[]>();
  readonly selected = input<number | null>(null);
  /** texto do item "todos" (sem = não mostra) */
  readonly allLabel = input<string | null>(null);
  readonly total = input<number | null>(null);
  readonly picked = output<number | null>();
  readonly menu = output<{ event: MouseEvent; agent: Agent }>();
}
