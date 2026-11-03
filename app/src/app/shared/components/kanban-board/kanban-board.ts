import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ContextMenuService } from '../../services/context-menu/context-menu.service';
import { AgentsService } from '../../services/agents/agents.service';
import { ChatService } from '../../services/chat/chat.service';
import { DialogsService } from '../../services/dialogs/dialogs.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { ProposalsService } from '../../services/proposals/proposals.service';
import { COLUMNS, PRIORITY, Task, TaskColumn, TasksService } from '../../services/tasks/tasks.service';
import { Icon } from '../../ui/icon';

/** Quadro Kanban das tarefas. Sem projectSlug mostra todos os projetos vivos. */
@Component({
  selector: 'app-kanban-board',
  imports: [CdkDropListGroup, CdkDropList, CdkDrag, CdkDragPlaceholder, Icon, RouterLink],
  templateUrl: './kanban-board.html',
  host: { class: 'block h-full min-h-0' },
})
export class KanbanBoard {
  protected readonly tasks = inject(TasksService);
  protected readonly projects = inject(ProjectsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly menu = inject(ContextMenuService);
  private readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);
  private readonly proposals = inject(ProposalsService);

  readonly projectSlug = input<string | null>(null);

  /** "Em dev" só aparece em projeto onde pronto é produção (ou no quadro geral, se algum for) */
  protected readonly columns = computed(() => {
    const slug = this.projectSlug();
    const prod = slug ? this.projects.bySlug().get(slug)?.doneWhen === 'prod' : this.projects.living().some(p => p.doneWhen === 'prod');
    return COLUMNS.filter(c => c.id !== 'dev' || prod);
  });
  /** decisão esperando você sobre a tarefa (o agente parou nela) */
  protected readonly asking = computed(() => new Map(this.proposals.inbox().filter(p => p.taskId).map(p => [p.taskId!, p])));
  protected readonly priority = PRIORITY;
  protected readonly byColumn = computed(() => {
    const slug = this.projectSlug();
    const living = new Set(this.projects.living().map(p => p.slug));
    const visible = this.tasks.tasks().filter(t => (slug ? t.projectSlug === slug : living.has(t.projectSlug)));
    const sorted = [...visible].sort((a, b) => a.position - b.position || a.priority - b.priority);
    return Object.fromEntries(COLUMNS.map(c => [c.id, sorted.filter(t => t.column === c.id)])) as Record<TaskColumn, Task[]>;
  });

  protected drop(e: CdkDragDrop<TaskColumn, TaskColumn, Task>): void {
    if (e.previousContainer === e.container && e.previousIndex === e.currentIndex) return;
    this.tasks.move(e.item.data.id, e.container.data, e.currentIndex);
  }

  protected project(slug: string) { return this.projects.bySlug().get(slug) ?? null; }

  protected toAgent(t: Task, ev: Event): void {
    ev.stopPropagation();
    this.dialogs.newRun({
      projectSlug: t.projectSlug, repoPath: t.repoPath ?? undefined, taskId: t.id,
      prompt: [t.title, t.body].filter(Boolean).join('\n\n'),
    });
  }

  /** Chat com o agente do projeto (ou a Central), já com o contexto da tarefa. */
  protected talk(t: Task): void {
    const agent = this.agents.agents().find(a => a.projectSlug === t.projectSlug && !a.builtin) ?? this.agents.central();
    if (!agent) return;
    this.chat.compose(agent.id, `Sobre a tarefa #${t.id} "${t.title}" (${this.projects.bySlug().get(t.projectSlug)?.name ?? t.projectSlug}): `);
  }

  /** Botão direito num card. */
  protected cardMenu(e: MouseEvent, t: Task): void {
    this.menu.open(e, [
      { label: 'Editar', icon: 'edit', run: () => this.dialogs.editTask(t.id) },
      { label: 'Mandar para um agente', icon: 'play', run: () => this.toAgent(t, e), disabled: t.column === 'doing' || t.column === 'done' },
      { label: 'Conversar sobre esta tarefa', icon: 'central', run: () => this.talk(t) },
      ...(t.prUrl ? [{ label: 'Abrir PR', icon: 'pr' as const, run: () => this.projects.openExternal(t.prUrl!) }] : []),
      null,
      ...this.columns().filter(c => c.id !== t.column).map(c => ({ label: `Mover para ${c.label}`, icon: 'chevron' as const, run: () => this.tasks.move(t.id, c.id, 0) })),
      null,
      { label: 'Excluir', icon: 'delete', danger: true, run: () => { if (confirm(`Excluir "${t.title}"?`)) this.tasks.remove(t.id); } },
    ]);
  }

  protected openPr(t: Task, ev: Event): void {
    ev.stopPropagation();
    if (t.prUrl) this.projects.openExternal(t.prUrl);
  }
}
