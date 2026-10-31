import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';

import { Repo } from '../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RunPermission, RunSize, SIZES } from '../../../../shared/services/runs/runs.model';
import { Icon } from '../../../../shared/ui/icon';
import { Routine, RoutineDraft, RoutinesService, describeSchedule } from '../../services/routines/routines.service';

/** Estado de abertura: null fechado; routine null = nova; draft = modelo pronto para começar. */
export type RoutineDialogState = { routine: Routine | null; draft?: Partial<RoutineDraft> } | null;

@Component({
  selector: 'app-routine-dialog',
  imports: [Icon],
  templateUrl: './routine-dialog.html',
})
export class RoutineDialog {
  protected readonly projects = inject(ProjectsService);
  private readonly routines = inject(RoutinesService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  readonly state = input<RoutineDialogState>(null);
  readonly closed = output<void>();

  protected readonly sizes = SIZES;
  protected readonly weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  protected readonly name = signal('');
  protected readonly projectSlug = signal('');
  protected readonly repos = signal<Repo[]>([]);
  protected readonly repoPath = signal<string>('');
  protected readonly prompt = signal('');
  protected readonly permission = signal<RunPermission>('edits');
  protected readonly size = signal<RunSize>('small');
  protected readonly scheduleKind = signal<'daily' | 'interval'>('daily');
  protected readonly days = signal<number[]>([1, 2, 3, 4, 5]);
  protected readonly time = signal('08:00');
  protected readonly intervalHours = signal(6);
  protected readonly maxSession = signal(80);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly schedule = computed(() => describeSchedule({
    scheduleKind: this.scheduleKind(), days: this.days(), time: this.time(), intervalHours: this.intervalHours(),
  }));

  constructor() {
    effect(() => {
      const s = this.state();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (s && !el.open) { this.fill(s); el.showModal(); }
      if (!s && el.open) el.close();
    });
  }

  protected async selectProject(slug: string, repo = ''): Promise<void> {
    this.projectSlug.set(slug);
    this.repoPath.set(repo);
    this.repos.set(slug ? await this.projects.repos(slug) : []);
  }

  protected toggleDay(d: number): void {
    this.days.update(list => (list.includes(d) ? list.filter(x => x !== d) : [...list, d].sort()));
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.name().trim() || !this.prompt().trim() || !this.projectSlug()) return;
    if (this.scheduleKind() === 'daily' && !this.days().length) { this.error.set('Escolha pelo menos um dia.'); return; }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.routines.save(this.state()?.routine?.id ?? null, {
        name: this.name().trim(), projectSlug: this.projectSlug(), repoPath: this.repoPath() || null, prompt: this.prompt().trim(),
        permission: this.permission(), size: this.size(), scheduleKind: this.scheduleKind(), days: this.days(), time: this.time(),
        intervalHours: this.intervalHours(), maxSession: this.maxSession(), enabled: this.state()?.routine?.enabled ?? true,
      });
      this.closed.emit();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  private fill(s: NonNullable<RoutineDialogState>): void {
    const r = s.routine ?? s.draft ?? {};
    this.name.set(r.name ?? ''); this.prompt.set(r.prompt ?? ''); this.permission.set(r.permission ?? 'edits'); this.size.set(r.size ?? 'small');
    this.scheduleKind.set(r.scheduleKind ?? 'daily'); this.days.set(r.days ?? [1, 2, 3, 4, 5]); this.time.set(r.time ?? '08:00');
    this.intervalHours.set(r.intervalHours ?? 6); this.maxSession.set(r.maxSession ?? 80);
    this.error.set(null); this.busy.set(false);
    this.selectProject(r.projectSlug ?? this.projects.living()[0]?.slug ?? '', r.repoPath ?? '');
  }
}
