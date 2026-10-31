import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ActivityService, CommitDay } from '../../../../shared/services/activity/activity.service';
import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { Project, STATUS_LABEL } from '../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { RUN_STATUS_LABEL } from '../../../../shared/services/runs/runs.model';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Heartbeat } from '../../../../shared/ui/heartbeat';

@Component({
  selector: 'app-overview-page',
  imports: [RouterLink, Heartbeat, AgoPipe],
  templateUrl: './overview-page.html',
  host: { class: 'block h-full overflow-y-auto' },
})
export class OverviewPage {
  protected readonly projects = inject(ProjectsService);
  protected readonly proposals = inject(ProposalsService);
  protected readonly runs = inject(RunsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly activity = inject(ActivityService);

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly runLabel = RUN_STATUS_LABEL;
  protected readonly days = signal<CommitDay[]>([]);
  protected readonly today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  /** mais movimentado primeiro; empate pelo commit mais recente */
  protected readonly board = computed(() => [...this.projects.living()].sort((a, b) =>
    b.commits7d - a.commits7d || (b.lastCommitAt?.getTime() ?? 0) - (a.lastCommitAt?.getTime() ?? 0)));
  protected readonly commits7d = computed(() => this.projects.living().reduce((n, p) => n + p.commits7d, 0));
  protected readonly quiet = computed(() =>
    this.projects.living().filter(p => p.status === 'active' && !p.commits7d).map(p => p.name).join(', '));
  protected readonly recentRuns = computed(() => this.runs.runs().slice(0, 5));

  constructor() {
    // recarrega o feed sempre que os projetos mudam (sincronização, novo projeto)
    effect(() => {
      this.projects.projects();
      this.activity.byDay(null, 7, 150).then(d => this.days.set(d));
    });
  }

  protected attention(p: Project): string[] {
    const out: string[] = [];
    if (!p.folderExists) out.push('pasta não existe');
    if (p.openProposals) out.push(`${p.openProposals} ${p.openProposals === 1 ? 'decisão' : 'decisões'}`);
    if (p.dirtyRepos) out.push(`${p.dirtyRepos} ${p.dirtyRepos === 1 ? 'repo' : 'repos'} com mudança sem commit`);
    return out;
  }

  protected color(slug: string): string {
    return this.projects.bySlug().get(slug)?.color ?? 'var(--color-faint)';
  }
}
