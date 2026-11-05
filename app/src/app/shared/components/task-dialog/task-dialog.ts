import { RouterLink } from '@angular/router';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ProjectSelect } from '../pickers/project-select';

import { DialogsService } from '../../services/dialogs/dialogs.service';
import { errorMessage } from '../../services/ipc/ipc.service';
import { Repo } from '../../services/projects/projects.model';
import { ProjectsService } from '../../services/projects/projects.service';
import { BoardService, COLORS } from '../../services/board/board.service';
import { DeliveriesService } from '../../services/deliveries/deliveries.service';
import { COLUMNS, PRIORITY, TaskColumn, TaskPriority, TasksService } from '../../services/tasks/tasks.service';
import { Icon } from '../../ui/icon';
import { AgentsService } from '../../services/agents/agents.service';
import { ChatService } from '../../services/chat/chat.service';

import { AskService } from '../../services/ask/ask.service';
@Component({
  selector: 'app-task-dialog',
  imports: [Icon, ProjectSelect, RouterLink],
  templateUrl: './task-dialog.html',
})
export class TaskDialog {
  private readonly ask = inject(AskService);
  private readonly dialogs = inject(DialogsService);
  private readonly tasks = inject(TasksService);
  private readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);
  private readonly deliveries = inject(DeliveriesService);
  protected readonly boards = inject(BoardService);
  protected readonly tasksSvc = inject(TasksService);
  protected readonly colors = COLORS;
  /** quadros em que a tarefa está */
  protected readonly placements = computed(() => { const t = this.editing(); return t ? this.boards.ofTask().get(t.id) ?? [] : []; });
  protected readonly otherBoards = computed(() => { const on = new Set(this.placements().map(p => p.boardId)); return this.boards.boards().filter(b => !on.has(b.id)); });
  protected readonly projects = inject(ProjectsService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly state = this.dialogs.task;
  protected readonly editing = computed(() => {
    const s = this.state();
    return s?.mode === 'edit' ? this.tasks.tasks().find(t => t.id === s.id) ?? null : null;
  });

  protected readonly columns = COLUMNS;
  protected readonly priorities = ([0, 1, 2, 3] as TaskPriority[]).map(p => ({ value: p, ...PRIORITY[p] }));

  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly projectSlug = signal('');
  protected readonly repoPath = signal('');
  protected readonly repos = signal<Repo[]>([]);
  protected readonly column = signal<TaskColumn>('backlog');
  protected readonly priority = signal<TaskPriority>(2);
  /** "#21, #22" */
  protected readonly deps = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const s = this.state();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (s && !el.open) { this.fill(); el.showModal(); }
      if (!s && el.open) el.close();
    });
  }

  protected close(): void { this.state.set(null); }

  protected async selectProject(slug: string, repoPath = ''): Promise<void> {
    this.projectSlug.set(slug);
    this.repoPath.set(repoPath);
    this.repos.set(slug ? await this.projects.repos(slug) : []);
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    // pedido solto (sem projeto) de um quadro pode ser editado sem escolher projeto
    if (!this.title().trim() || (!this.projectSlug() && !(this.editing() && !this.editing()!.projectSlug))) return;
    this.busy.set(true);
    const draft = {
      projectSlug: this.projectSlug(), repoPath: this.repoPath() || null, title: this.title().trim(), body: this.body().trim(),
      column: this.column(), priority: this.priority(),
      dependsOn: [...this.deps().matchAll(/\d+/g)].map(m => Number(m[0])),
    };
    try {
      const t = this.editing();
      if (t) await this.tasks.save(t.id, draft);
      else await this.tasks.create(draft);
      this.close();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Feito: se a tarefa tem entrega na fila de revisão, aceita a entrega (que move a tarefa); senão só move. */
  protected markDone(): void {
    const t = this.editing();
    if (!t) return;
    const d = this.deliveries.queue().find(x => x.taskId === t.id);
    if (d) this.deliveries.accept(d);
    else this.tasks.move(t.id, 'done', 0);
    this.close();
  }

  protected addToBoard(taskId: number, boardId: string): void {
    const b = this.boards.byId().get(Number(boardId));
    if (b?.columns.length) this.boards.place(taskId, b.id, b.columns[0].key);
  }

  protected async remove(): Promise<void> {
    const t = this.editing();
    if (t && (await this.ask.confirm(`Excluir a tarefa "${t.title}"?`, { confirmLabel: 'Excluir tarefa', danger: true }))) { this.tasks.remove(t.id); this.close(); }
  }

  protected talk(): void {
    const t = this.editing();
    if (!t) return;
    const agent = this.agents.agents().find(a => a.projectSlug === t.projectSlug && !a.builtin) ?? this.agents.central();
    if (!agent) return;
    this.close();
    this.chat.compose(agent.id, `Sobre a tarefa #${t.id} "${t.title}" (${this.projects.bySlug().get(t.projectSlug ?? '')?.name ?? 'sem projeto'}): `);
  }

  protected toAgent(): void {
    const t = this.editing();
    if (!t) return;
    this.close();
    this.dialogs.newRun({
      projectSlug: t.projectSlug, repoPath: t.repoPath ?? undefined, taskId: t.id, prompt: [t.title, t.body].filter(Boolean).join('\n\n'),
    });
  }

  private fill(): void {
    const s = this.state()!;
    this.error.set(null);
    this.busy.set(false);
    const t = this.editing();
    if (t) {
      this.title.set(t.title); this.body.set(t.body ?? ''); this.column.set(t.column); this.priority.set(t.priority); this.deps.set(t.dependsOn.map(id => `#${id}`).join(', '));
      this.selectProject(t.projectSlug ?? '', t.repoPath ?? '');
    } else if (s.mode === 'create') {
      this.title.set(s.title ?? ''); this.body.set(s.body ?? ''); this.column.set(s.column ?? 'backlog'); this.priority.set(2); this.deps.set('');
      this.selectProject(s.projectSlug ?? this.projects.defaultSlug());
    }
  }
}
