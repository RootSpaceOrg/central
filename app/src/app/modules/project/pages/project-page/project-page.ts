import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { SessionKind } from '../../../../shared/contract';
import { SessionsService } from '../../../../shared/services/sessions/sessions.service';
import { ProjectSessions } from './components/sessions/sessions';
import { ContextView } from './components/context/context-view';
import { EditorService } from '../../services/editor/editor.service';
import { CODE_TAB } from '../../../../shared/services/sessions/sessions.service';
import { RoadmapTab } from './components/roadmap/roadmap-tab';
import { ReleasePanel } from './components/release/release-panel';
import { TodoOwner } from './components/todo-owner/todo-owner';
import { Summary } from './components/summary/summary';

type Tab = 'sessoes' | 'rumo' | 'roadmap' | 'backlog' | 'producao' | 'contexto' | 'agentes';
const TABS = [
  { id: 'sessoes', label: 'Sessões', icon: 'terminal' }, { id: 'rumo', label: 'Rumo', icon: 'flag' },
  { id: 'roadmap', label: 'Roadmap', icon: 'roadmap' },
  { id: 'backlog', label: 'Backlog', icon: 'kanban' }, { id: 'producao', label: 'Produção', icon: 'rocket' }, { id: 'contexto', label: 'Contexto', icon: 'graph' }, { id: 'agentes', label: 'Agentes', icon: 'agent' },
] as const;

@Component({
  selector: 'app-project-page',
  imports: [RouterLink, Icon, AgoPipe, Summary, ProjectSessions, KanbanBoard, ProjectAvatar, ContextView, RoadmapTab, ReleasePanel, TodoOwner],
  templateUrl: './project-page.html',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class ProjectPage {
  protected readonly projects = inject(ProjectsService);
  protected readonly runs = inject(RunsService);
  protected readonly dialogs = inject(DialogsService);

  private readonly sessions = inject(SessionsService);
  private readonly editor = inject(EditorService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly query = toSignal(this.route.queryParamMap);
  private readonly slug = toSignal(this.route.paramMap.pipe(map(p => p.get('slug')!)), { requireSync: true });
  protected readonly project = computed(() => this.projects.bySlug().get(this.slug()) ?? null);
  protected readonly projectRuns = computed(() => this.runs.runs().filter(r => r.projectSlug === this.slug()));

  protected readonly tabs = TABS;
  /** ?aba=backlog abre direto numa aba; ?nova=chat abre uma sessão nova */
  protected readonly tab = signal<Tab>('sessoes');
  /** as sessões só montam na primeira visita e depois ficam vivas (terminais, editor) */
  protected readonly sessionsMounted = signal(false);

  protected readonly statuses = Object.keys(STATUS_LABEL) as ProjectStatus[];
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly runLabel = RUN_STATUS_LABEL;
  protected readonly isActive = isActive;

  constructor() {
    effect(() => { if (this.tab() === 'sessoes') this.sessionsMounted.set(true); });
    effect(() => {
      const q = this.query();
      const slug = this.slug();
      untracked(() => {
        const aba = (q?.get('aba') === 'resumo' ? 'rumo' : q?.get('aba')) as Tab | null;
        const nova = q?.get('nova') as SessionKind | null;
        this.tab.set(nova ? 'sessoes' : TABS.some(t => t.id === aba) ? aba! : 'sessoes');
        if (nova) {
          this.sessions.open(slug, nova);
          this.router.navigate([], { queryParams: { nova: null }, queryParamsHandling: 'merge', replaceUrl: true });
        }
      });
    });
  }

  protected go(tab: Tab): void { this.tab.set(tab); }

  /** "Abrir no editor" do grafo: vai para a aba de código das sessões com o arquivo aberto. */
  protected openFile(path: string): void {
    const slug = this.slug();
    this.sessions.select(slug, CODE_TAB);
    this.tab.set('sessoes');
    this.editor.open(slug, path);
  }
}
