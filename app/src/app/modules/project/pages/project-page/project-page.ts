import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { ProjectStatus, STATUS_LABEL } from '../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RUN_STATUS_LABEL, isActive } from '../../../../shared/services/runs/runs.model';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { KanbanBoard } from '../../../../shared/components/kanban-board/kanban-board';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { CodeWorkspace } from './components/code-workspace/code-workspace';
import { Summary } from './components/summary/summary';

type Tab = 'resumo' | 'backlog' | 'codigo' | 'agentes';

@Component({
  selector: 'app-project-page',
  imports: [RouterLink, Icon, AgoPipe, Summary, CodeWorkspace, KanbanBoard, ProjectAvatar],
  templateUrl: './project-page.html',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class ProjectPage {
  protected readonly projects = inject(ProjectsService);
  protected readonly runs = inject(RunsService);
  protected readonly dialogs = inject(DialogsService);

  private readonly route = inject(ActivatedRoute);
  private readonly slug = toSignal(this.route.paramMap.pipe(map(p => p.get('slug')!)), { requireSync: true });
  protected readonly project = computed(() => this.projects.bySlug().get(this.slug()) ?? null);
  protected readonly projectRuns = computed(() => this.runs.runs().filter(r => r.projectSlug === this.slug()));

  /** ?aba=codigo abre direto numa aba */
  protected readonly tab = signal<Tab>((this.route.snapshot.queryParamMap.get('aba') as Tab) || 'resumo');
  /** a área de código só monta na primeira visita e depois fica viva (terminais, editor) */
  protected readonly codeMounted = signal(false);

  protected readonly statuses = Object.keys(STATUS_LABEL) as ProjectStatus[];
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly runLabel = RUN_STATUS_LABEL;
  protected readonly isActive = isActive;

  constructor() {
    effect(() => { if (this.tab() === 'codigo') this.codeMounted.set(true); });
  }

  protected go(tab: Tab): void { this.tab.set(tab); }
}
