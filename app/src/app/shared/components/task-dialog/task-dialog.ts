import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';

import { DialogsService } from '../../services/dialogs/dialogs.service';
import { errorMessage } from '../../services/ipc/ipc.service';
import { Repo } from '../../services/projects/projects.model';
import { ProjectsService } from '../../services/projects/projects.service';
import { COLUMNS, PRIORITY, TaskColumn, TaskPriority, TasksService } from '../../services/tasks/tasks.service';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'app-task-dialog',
  imports: [Icon],
  templateUrl: './task-dialog.html',
})
export class TaskDialog {
  private readonly dialogs = inject(DialogsService);
  private readonly tasks = inject(TasksService);
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
    if (!this.title().trim() || !this.projectSlug()) return;
    this.busy.set(true);
    const draft = {
      projectSlug: this.projectSlug(), repoPath: this.repoPath() || null, title: this.title().trim(), body: this.body().trim(),
      column: this.column(), priority: this.priority(),
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

  protected remove(): void {
    const t = this.editing();
    if (t && confirm(`Excluir "${t.title}"?`)) { this.tasks.remove(t.id); this.close(); }
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
      this.title.set(t.title); this.body.set(t.body ?? ''); this.column.set(t.column); this.priority.set(t.priority);
      this.selectProject(t.projectSlug, t.repoPath ?? '');
    } else if (s.mode === 'create') {
      this.title.set(s.title ?? ''); this.body.set(s.body ?? ''); this.column.set(s.column ?? 'backlog'); this.priority.set(2);
      this.selectProject(s.projectSlug ?? this.projects.living()[0]?.slug ?? '');
    }
  }
}
