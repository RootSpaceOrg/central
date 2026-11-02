import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ChatView } from '../../../../shared/components/chat-view/chat-view';
import { Agent, AgentsService, MODELS } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { ContextMenuService } from '../../../../shared/services/context-menu/context-menu.service';
import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RUN_STATUS_LABEL, isActive } from '../../../../shared/services/runs/runs.model';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { AgentDialog, AgentDialogState } from '../../components/agent-dialog/agent-dialog';
import { MemoryPanel, MemoryView } from '../../components/memory-panel/memory-panel';
import { MemoriesService } from '../../../../shared/services/memories/memories.service';

type Pane = 'conversas' | 'execucoes' | 'memoria';

/** Agentes: escolhe um agente, vê as sessões dele (conversas e execuções) e conversa. */
@Component({
  selector: 'app-agents-page',
  imports: [RouterLink, Icon, AgoPipe, ProjectAvatar, ChatView, AgentDialog, MemoryPanel],
  templateUrl: './agents-page.html',
  host: { class: 'grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)]' },
})
export class AgentsPage {
  protected readonly agents = inject(AgentsService);
  protected readonly chat = inject(ChatService);
  protected readonly projects = inject(ProjectsService);
  protected readonly runs = inject(RunsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly menu = inject(ContextMenuService);
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  protected readonly dialog = signal<AgentDialogState>(null);
  protected readonly pane = signal<Pane>('conversas');
  protected readonly memView = signal<MemoryView>('dele');
  protected readonly memories = inject(MemoriesService);
  protected readonly runLabel = RUN_STATUS_LABEL;
  protected readonly isActive = isActive;

  protected readonly selected = computed(() => this.chat.agent());
  protected readonly agentRuns = computed(() => this.runs.runs().filter(r => r.agentId === this.selected()?.id).slice(0, 60));
  protected readonly modelLabel = (m: string) => MODELS.find(x => x.value === m)?.label ?? m;

  constructor() {
    // ?agente=3&conversa=12 (vindo do painel, de uma execução ou do menu de projeto)
    effect(() => {
      const q = this.query();
      const agentId = Number(q?.get('agente'));
      const chatId = Number(q?.get('conversa'));
      const novo = q?.get('novo');
      if (!this.agents.loaded()) return;
      untracked(() => {
        // ?novo=<projeto>: "Criar agente para o projeto" no menu de botão direito
        if (novo) this.dialog.set({ agent: null, projectSlug: novo });
        else if (q?.get('criar')) this.dialog.set({ agent: null });
        if (chatId) this.chat.select(chatId);
        else if (agentId) this.chat.selectAgent(agentId);
        else if (!this.chat.agentId() && this.agents.central()) this.chat.selectAgent(this.agents.central()!.id);
      });
    });
  }

  protected pick(a: Agent): void {
    this.chat.selectAgent(a.id);
    this.router.navigate([], { queryParams: { agente: a.id, conversa: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected newRun(a: Agent): void {
    this.dialogs.newRun({ agentId: a.id, projectSlug: a.projectSlug });
  }

  protected newRoutine(a: Agent): void {
    this.router.navigate(['/rotinas'], { queryParams: { nova: 1, agente: a.id } });
  }

  protected closed(savedId: number | null): void {
    this.dialog.set(null);
    if (savedId) this.chat.selectAgent(savedId);
  }

  protected rename(id: number, current: string): void {
    const title = prompt('Nome da conversa', current);
    if (title?.trim()) this.chat.rename(id, title);
  }

  protected agentMenu(e: MouseEvent, a: Agent): void {
    this.menu.open(e, [
      { label: 'Conversar', icon: 'central', run: () => this.pick(a) },
      { label: 'Nova conversa', icon: 'plus', run: () => { this.pick(a); this.chat.newChat(a.id); } },
      { label: 'Mandar uma tarefa', icon: 'play', run: () => this.newRun(a) },
      { label: 'Nova rotina', icon: 'routine', run: () => this.newRoutine(a) },
      null,
      { label: 'Editar', icon: 'edit', run: () => this.dialog.set({ agent: a }) },
      ...(a.builtin ? [] : [{ label: 'Excluir', icon: 'delete' as const, danger: true, run: () => this.dialog.set({ agent: a }) }]),
    ]);
  }
}
