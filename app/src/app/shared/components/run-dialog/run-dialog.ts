import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { DialogsService } from '../../services/dialogs/dialogs.service';
import { Repo } from '../../services/projects/projects.model';
import { ProjectsService } from '../../services/projects/projects.service';
import { RunPermission } from '../../services/runs/runs.model';
import { RunsService } from '../../services/runs/runs.service';
import { AgoPipe } from '../../ui/ago.pipe';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'app-run-dialog',
  imports: [Icon, AgoPipe],
  templateUrl: './run-dialog.html',
})
export class RunDialog {
  private readonly dialogs = inject(DialogsService);
  protected readonly projects = inject(ProjectsService);
  private readonly runs = inject(RunsService);
  private readonly router = inject(Router);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly state = this.dialogs.run;
  protected readonly projectSlug = signal('');
  protected readonly repos = signal<Repo[]>([]);
  protected readonly repoPath = signal('');
  protected readonly prompt = signal('');
  protected readonly budget = signal(5);
  protected readonly permission = signal<RunPermission>('edits');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly project = computed(() => this.projects.bySlug().get(this.projectSlug()) ?? null);
  protected readonly canSubmit = computed(() => !!this.repoPath() && !!this.prompt().trim() && !this.busy());

  constructor() {
    effect(() => {
      const s = this.state();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (s && !el.open) {
        this.prompt.set(s.prompt ?? '');
        this.error.set(null);
        this.busy.set(false);
        this.selectProject(s.projectSlug ?? this.projects.living()[0]?.slug ?? '', s.repoPath);
        el.showModal();
      }
      if (!s && el.open) el.close();
    });
  }

  protected close(): void { this.state.set(null); }

  protected async selectProject(slug: string, repoPath?: string): Promise<void> {
    this.projectSlug.set(slug);
    this.repos.set([]);
    this.repoPath.set('');
    if (!slug) return;
    const repos = await this.projects.repos(slug);
    if (this.projectSlug() !== slug) return;
    this.repos.set(repos);
    this.repoPath.set(repos.find(r => r.path === repoPath)?.path ?? repos[0]?.path ?? '');
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const run = await this.runs.start({
        projectSlug: this.projectSlug(), repoPath: this.repoPath(), prompt: this.prompt(),
        budgetUsd: this.budget(), permission: this.permission(), proposalId: this.state()?.proposalId ?? null,
        taskId: this.state()?.taskId ?? null,
      });
      this.close();
      this.router.navigate(['/agentes'], { queryParams: { run: run.id } });
    } catch (err) {
      this.error.set((err as Error).message);
      this.busy.set(false);
    }
  }
}
