import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectSelect } from '../../../../shared/components/pickers/project-select';

import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RISK_LABEL, SOURCE_LABEL, Verdict } from '../../../../shared/services/proposals/proposals.model';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { Task, TasksService } from '../../../../shared/services/tasks/tasks.service';
import { Icon } from '../../../../shared/ui/icon';

const KEYS: Record<string, Verdict> = { a: 'approve', d: 'defer', n: 'reject' };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

@Component({
  selector: 'app-inbox-page',
  imports: [Icon, RouterLink, ProjectSelect],
  templateUrl: './inbox-page.html',
  host: { class: 'block h-full overflow-y-auto', '(document:keydown)': 'onKey($event)' },
})
export class InboxPage {
  protected readonly proposals = inject(ProposalsService);
  protected readonly projects = inject(ProjectsService);
  private readonly dialogs = inject(DialogsService);
  private readonly tasks = inject(TasksService);
  /** decisões aprovadas viram tarefas; mostra as que ainda não terminaram */
  protected readonly approvedTasks = computed(() => this.tasks.tasks().filter(t => t.proposalId && t.column !== 'done'));

  protected readonly current = computed(() => this.proposals.inbox()[0] ?? null);
  protected readonly behind = computed(() => Math.min(this.proposals.inbox().length - 1, 2));
  protected readonly leaving = signal<Verdict | null>(null);

  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly projectSlug = signal('');
  protected readonly captureError = signal<string | null>(null);

  protected readonly risk = RISK_LABEL;
  protected readonly source = (s: string) => SOURCE_LABEL[s] ?? s;

  protected project(slug: string | null) {
    return slug ? this.projects.bySlug().get(slug) ?? null : null;
  }

  protected decide(verdict: Verdict): void {
    const p = this.current();
    if (!p || this.leaving()) return;
    this.leaving.set(verdict);
    setTimeout(() => {
      this.proposals.decide(p, verdict);
      this.leaving.set(null);
    }, reducedMotion() ? 120 : 220);
  }

  protected onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.querySelector('dialog[open]')) return;
    const verdict = KEYS[e.key.toLowerCase()];
    if (verdict) this.decide(verdict);
  }

  protected toAgent(t: Task): void {
    this.dialogs.newRun({ projectSlug: t.projectSlug, repoPath: t.repoPath ?? undefined, taskId: t.id, proposalId: t.proposalId,
      prompt: [t.title, t.body].filter(Boolean).join('\n\n') });
  }

  protected async capture(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.title().trim()) return;
    try {
      await this.proposals.create(this.title().trim(), this.body().trim(), this.projectSlug() || null);
      this.title.set('');
      this.body.set('');
      this.captureError.set(null);
    } catch (err) {
      this.captureError.set(errorMessage(err));
    }
  }
}
