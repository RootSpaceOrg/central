import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ActivityService, CommitDay } from '../../../../../../shared/services/activity/activity.service';
import { DialogsService } from '../../../../../../shared/services/dialogs/dialogs.service';
import { Project, Repo } from '../../../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { ProposalsService } from '../../../../../../shared/services/proposals/proposals.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Heartbeat } from '../../../../../../shared/ui/heartbeat';
import { Icon } from '../../../../../../shared/ui/icon';

@Component({
  selector: 'app-summary',
  imports: [RouterLink, AgoPipe, Heartbeat, Icon],
  templateUrl: './summary.html',
  host: { class: 'block h-full overflow-y-auto' },
})
export class Summary {
  protected readonly projects = inject(ProjectsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly proposalsService = inject(ProposalsService);
  private readonly activity = inject(ActivityService);

  readonly project = input.required<Project>();

  protected readonly repos = signal<Repo[]>([]);
  protected readonly days = signal<CommitDay[]>([]);
  protected readonly proposals = computed(() =>
    [...this.proposalsService.inbox(), ...this.proposalsService.approved()].filter(p => p.projectSlug === this.project().slug));

  constructor() {
    // recarrega quando muda o projeto ou quando a sincronização termina (lastSync)
    effect(() => {
      const slug = this.project().slug;
      this.projects.lastSync();
      this.projects.repos(slug).then(r => this.project().slug === slug && this.repos.set(r));
      this.activity.byDay(slug, 30, 300).then(d => this.project().slug === slug && this.days.set(d));
    });
  }

  protected saveDescription(value: string): void {
    if (value.trim() !== (this.project().description ?? '')) this.projects.setDescription(this.project().slug, value.trim());
  }

  protected newRun(repo: Repo): void {
    this.dialogs.newRun({ projectSlug: this.project().slug, repoPath: repo.path });
  }
}
