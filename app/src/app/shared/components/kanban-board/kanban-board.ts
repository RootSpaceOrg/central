import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ContextMenuService } from '../../services/context-menu/context-menu.service';
import { AgentsService } from '../../services/agents/agents.service';
import { ChatService } from '../../services/chat/chat.service';
import { DialogsService } from '../../services/dialogs/dialogs.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { BoardService, COLORS } from '../../services/board/board.service';
import { ProposalsService } from '../../services/proposals/proposals.service';
import { COLUMNS, PRIORITY, Task, TaskColumn, TasksService } from '../../services/tasks/tasks.service';
import { Icon } from '../../ui/icon';

import { AskService } from '../../services/ask/ask.service';
/** Quadro Kanban das tarefas. Sem projectSlug mostra todos os projetos vivos. */
/** Coluna do backlog principal na tela. */
interface ViewColumn { id: string; label: string; kind: TaskColumn; hint: string }

@Component({
  selector: 'app-kanban-board',
  imports: [CdkDropListGroup, CdkDropList, CdkDrag, CdkDragPlaceholder, Icon, RouterLink],
  templateUrl: './kanban-board.html',
  host: { class: 'block h-full min-h-0' },
})
export class KanbanBoard {
  private readonly ask = inject(AskService);
  protected readonly tasks = inject(TasksService);
  protected readonly projects = inject(ProjectsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly menu = inject(ContextMenuService);
  private readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);
  private readonly proposals = inject(ProposalsService);
  protected readonly boards = inject(BoardService);

  readonly projectSlug = input<string | null>(null);

  /** colunas fixas do backlog principal ("Em dev" só onde pronto é produção) */
  protected readonly columns = computed<ViewColumn[]>(() => {
    const slug = this.projectSlug();
    const project = slug ? this.projects.bySlug().get(slug) : null;
    const prod = project ? project.doneWhen === 'prod' : this.projects.living().some(p => p.doneWhen === 'prod');
    // o que a coluna quer dizer neste projeto: quem pega o "A fazer" e o que conta como pronto
    const owner = project?.todoAgentId ? this.agents.byId().get(project.todoAgentId)?.name : null;
    const hint = (id: TaskColumn, base: string) =>
      id === 'todo' && owner ? `Pronto para começar: ${owner} pega sozinho.`
        : id === 'done' && prod ? (project ? 'Em produção (chegou na main).' : 'PR mergeado; nos projetos com "Em dev", só depois de ir para produção.')
          : base;
    return COLUMNS.filter(c => c.id !== 'dev' || prod).map(c => ({ id: c.id, label: c.label, kind: c.id, hint: hint(c.id, c.hint) }));
  });
  /** decisão esperando você sobre a tarefa (o agente parou nela) */
  protected readonly asking = computed(() => new Map(this.proposals.inbox().filter(p => p.taskId).map(p => [p.taskId!, p])));
  protected readonly priority = PRIORITY;
  protected readonly byColumn = computed(() => {
    const slug = this.projectSlug();
    const living = new Set(this.projects.living().map(p => p.slug));
    const visible = this.tasks.tasks().filter(t => (slug ? t.projectSlug === slug : !!t.projectSlug && living.has(t.projectSlug)));
    const sorted = [...visible].sort((a, b) => a.position - b.position || a.priority - b.priority);
    return Object.fromEntries(COLUMNS.map(c => [c.id, sorted.filter(t => t.column === c.id)])) as Record<string, Task[]>;
  });

  protected drop(e: CdkDragDrop<string, string, Task>): void {
    if (e.previousContainer === e.container && e.previousIndex === e.currentIndex) return;
    this.tasks.move(e.item.data.id, e.container.data as TaskColumn, e.currentIndex);
  }

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

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
    this.chat.compose(agent.id, `Sobre a tarefa #${t.id} "${t.title}" (${this.projects.bySlug().get(t.projectSlug ?? '')?.name ?? 'sem projeto'}): `);
  }

  /** Botão direito num card. */
  protected cardMenu(e: MouseEvent, t: Task): void {
    this.menu.open(e, [
      { label: 'Editar', icon: 'edit', run: () => this.dialogs.editTask(t.id) },
      { label: 'Mandar para um agente', icon: 'play', run: () => this.toAgent(t, e), disabled: t.column === 'doing' || t.column === 'done' },
      { label: 'Conversar sobre esta tarefa', icon: 'central', run: () => this.talk(t) },
      ...(t.prUrl ? [{ label: 'Abrir PR', icon: 'pr' as const, run: () => this.projects.openExternal(t.prUrl!) }] : []),
      null,
      ...COLORS.map(k => ({ label: k.label, swatch: k.value, hint: t.color === k.value ? 'atual' : undefined, run: () => this.tasks.setColor(t.id, k.value) })),
      ...(t.color ? [{ label: 'Cor padrão', icon: 'close' as const, run: () => this.tasks.setColor(t.id, null) }] : []),
      null,
      ...this.columns().filter(c => c.id !== t.column).map(c => ({ label: `Mover para ${c.label}`, icon: 'chevron' as const, run: () => this.tasks.move(t.id, c.kind, 0) })),
      null,
      { label: 'Excluir', icon: 'delete', danger: true, run: async () => { if (await this.ask.confirm(`Excluir a tarefa "${t.title}"?`, { confirmLabel: 'Excluir tarefa', danger: true })) this.tasks.remove(t.id); } },
    ]);
  }

  protected openPr(t: Task, ev: Event): void {
    ev.stopPropagation();
    if (t.prUrl) this.projects.openExternal(t.prUrl);
  }
}
