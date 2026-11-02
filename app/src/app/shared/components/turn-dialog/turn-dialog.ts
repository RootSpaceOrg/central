import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ProjectSelect } from '../pickers/project-select';

import { DialogsService } from '../../services/dialogs/dialogs.service';
import { Repo } from '../../services/projects/projects.model';
import { ProjectsService } from '../../services/projects/projects.service';
import { RunPermission, RunSize, SIZES } from '../../services/runs/runs.model';
import { TasksService } from '../../services/tasks/tasks.service';
import { TurnsService } from '../../services/turns/turns.service';
import { UsageService, untilReset } from '../../services/usage/usage.service';
import { Icon } from '../../ui/icon';

/** "Deixar evoluindo": escolhe tarefas, até que horas e quanto pode gastar. */
@Component({
  selector: 'app-turn-dialog',
  imports: [Icon, ProjectSelect],
  templateUrl: './turn-dialog.html',
})
export class TurnDialog {
  private readonly dialogs = inject(DialogsService);
  private readonly tasks = inject(TasksService);
  private readonly turns = inject(TurnsService);
  private readonly router = inject(Router);
  protected readonly projects = inject(ProjectsService);
  protected readonly usage = inject(UsageService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly state = this.dialogs.turn;
  protected readonly projectSlug = signal('');
  protected readonly repos = signal<Repo[]>([]);
  /** tarefa → repositório escolhido; ausente = não vai no turno */
  protected readonly picked = signal<Record<number, string>>({});
  protected readonly until = signal('07:00');
  protected readonly sizes = SIZES;
  protected readonly size = signal<RunSize>('medium');
  protected readonly permission = signal<RunPermission>('edits');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly candidates = computed(() => this.tasks.tasks()
    .filter(t => t.projectSlug === this.projectSlug() && (t.column === 'todo' || t.column === 'backlog'))
    .sort((a, b) => (a.column === b.column ? a.priority - b.priority : a.column === 'todo' ? -1 : 1)));
  protected readonly count = computed(() => Object.keys(this.picked()).length);
  protected readonly untilDate = computed(() => {
    const [h, m] = this.until().split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now() + 10 * 60_000) d.setDate(d.getDate() + 1);
    return d;
  });
  protected readonly untilLabel = computed(() => {
    const d = this.untilDate();
    const tomorrow = d.getDate() !== new Date().getDate();
    return `${tomorrow ? 'amanhã' : 'hoje'} às ${this.until()}`;
  });
  protected readonly reset = untilReset;

  constructor() {
    effect(() => {
      const s = this.state();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (s && !el.open) {
        this.error.set(null); this.busy.set(false); this.picked.set({});
        this.selectProject(s.projectSlug ?? this.projects.defaultSlug());
        el.showModal();
      }
      if (!s && el.open) el.close();
    });
  }

  protected close(): void { this.state.set(null); }

  protected async selectProject(slug: string): Promise<void> {
    this.projectSlug.set(slug);
    this.picked.set({});
    this.repos.set(slug ? await this.projects.repos(slug) : []);
  }

  protected isPicked(taskId: number): boolean { return taskId in this.picked(); }

  protected toggle(taskId: number, repoPath: string | null): void {
    this.picked.update(p => {
      const next = { ...p };
      if (taskId in next) delete next[taskId];
      else next[taskId] = repoPath ?? this.repos()[0]?.path ?? '';
      return next;
    });
  }

  protected setRepo(taskId: number, path: string): void {
    this.picked.update(p => ({ ...p, [taskId]: path }));
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    const items = Object.entries(this.picked()).map(([id, repoPath]) => ({ taskId: Number(id), repoPath }));
    if (!items.length) return;
    if (items.some(i => !i.repoPath)) { this.error.set('Escolha o repositório de cada tarefa.'); return; }
    this.busy.set(true);
    try {
      await this.turns.start(this.projectSlug(), items, this.untilDate(), SIZES.find(s => s.id === this.size())!.budget * items.length, this.permission());
      this.close();
      this.router.navigate(['/execucoes']);
    } catch (err) {
      this.error.set((err as Error).message);
      this.busy.set(false);
    }
  }
}
