import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { Component, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ContextMenuService } from '../../services/context-menu/context-menu.service';
import { AgentsService } from '../../services/agents/agents.service';
import { ChatService } from '../../services/chat/chat.service';
import { DialogsService } from '../../services/dialogs/dialogs.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { Agent } from '../../services/agents/agents.service';
import { BoardService, KIND_LABEL } from '../../services/board/board.service';
import { ProposalsService } from '../../services/proposals/proposals.service';
import { COLUMNS, PRIORITY, Task, TaskColumn, TasksService } from '../../services/tasks/tasks.service';
import { Icon } from '../../ui/icon';

/** Quadro Kanban das tarefas. Sem projectSlug mostra todos os projetos vivos. */
/** Coluna na tela: do workflow do projeto (custom) ou padrão (o tipo). */
interface ViewColumn { id: string; label: string; kind: TaskColumn; hint: string; agent: Agent | null; custom: boolean }

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
  private readonly boards = inject(BoardService);

  readonly projectSlug = input<string | null>(null);

  constructor() {
    effect(() => { const slug = this.projectSlug(); if (slug) this.boards.ensure(slug); });
  }

  /** quadro próprio do projeto (workflow), se houver */
  private readonly board = computed(() => { const slug = this.projectSlug(); return slug ? this.boards.bySlug()[slug] ?? [] : []; });
  /**
   * Colunas na tela: as do workflow do projeto, ou as padrão (com "Em dev" só onde pronto é produção).
   * id = key da coluna (workflow) ou o tipo (padrão).
   */
  protected readonly columns = computed<ViewColumn[]>(() => {
    const board = this.board();
    if (board.length) {
      return board.map(c => ({ id: c.key, label: c.label, kind: c.kind, hint: c.description ?? KIND_LABEL[c.kind],
        agent: c.agentId ? this.agents.byId().get(c.agentId) ?? null : null, custom: true }));
    }
    const slug = this.projectSlug();
    const prod = slug ? this.projects.bySlug().get(slug)?.doneWhen === 'prod' : this.projects.living().some(p => p.doneWhen === 'prod');
    return COLUMNS.filter(c => c.id !== 'dev' || prod).map(c => ({ id: c.id, label: c.label, kind: c.id, hint: c.hint, agent: null, custom: false }));
  });
  /** decisão esperando você sobre a tarefa (o agente parou nela) */
  protected readonly asking = computed(() => new Map(this.proposals.inbox().filter(p => p.taskId).map(p => [p.taskId!, p])));
  protected readonly priority = PRIORITY;
  protected readonly byColumn = computed(() => {
    const slug = this.projectSlug();
    const living = new Set(this.projects.living().map(p => p.slug));
    const visible = this.tasks.tasks().filter(t => (slug ? t.projectSlug === slug : living.has(t.projectSlug)));
    const sorted = [...visible].sort((a, b) => a.position - b.position || a.priority - b.priority);
    const board = this.board();
    if (!board.length) return Object.fromEntries(COLUMNS.map(c => [c.id, sorted.filter(t => t.column === c.id)])) as Record<string, Task[]>;
    // workflow: pela coluna da tarefa; tarefa sem coluna (antiga) cai na primeira do tipo dela
    const keys = new Set(board.map(c => c.key));
    const where = (t: Task) => (t.stage && keys.has(t.stage) ? t.stage : board.find(c => c.kind === t.column)?.key ?? board[0].key);
    return Object.fromEntries(board.map(c => [c.key, sorted.filter(t => where(t) === c.key)])) as Record<string, Task[]>;
  });

  protected drop(e: CdkDragDrop<string, string, Task>): void {
    if (e.previousContainer === e.container && e.previousIndex === e.currentIndex) return;
    const col = this.columns().find(c => c.id === e.container.data)!;
    if (col.custom) this.tasks.moveStage(e.item.data.id, col.id, col.kind, e.currentIndex);
    else this.tasks.move(e.item.data.id, col.kind, e.currentIndex);
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
      ...this.columns().filter(c => c.id !== (c.custom ? t.stage : t.column)).map(c => ({ label: `Mover para ${c.label}`, icon: 'chevron' as const,
        run: () => (c.custom ? this.tasks.moveStage(t.id, c.id, c.kind, 0) : this.tasks.move(t.id, c.kind, 0)) })),
      null,
      { label: 'Excluir', icon: 'delete', danger: true, run: () => { if (confirm(`Excluir "${t.title}"?`)) this.tasks.remove(t.id); } },
    ]);
  }

  protected openPr(t: Task, ev: Event): void {
    ev.stopPropagation();
    if (t.prUrl) this.projects.openExternal(t.prUrl);
  }
}
