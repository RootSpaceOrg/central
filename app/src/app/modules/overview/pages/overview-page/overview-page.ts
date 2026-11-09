import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ActivityService, CommitDay } from '../../../../shared/services/activity/activity.service';
import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { DirectionService } from '../../../../shared/services/direction/direction.service';
import { IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { Project, STATUS_LABEL } from '../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { RoadmapService } from '../../../../shared/services/roadmap/roadmap.service';
import { RUN_STATUS_LABEL } from '../../../../shared/services/runs/runs.model';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { TasksService } from '../../../../shared/services/tasks/tasks.service';
import { ReleaseService } from '../../../../shared/services/release/release.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Heartbeat } from '../../../../shared/ui/heartbeat';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { HEALTH, Health, Signal, health } from '../../health';

/** Um projeto na Visão geral: a saúde, os porquês e o resumo do que importa. */
interface Card {
  p: Project;
  /** "MatrizTech › Livros" para frentes */
  name: string;
  health: Health;
  signals: Signal[];
  backlog: { todo: number; doing: number; review: number; dev: number; urgent: number };
  now: { title: string; done: number; total: number; more: number } | null;
  rumoAt: Date | null;
  triage: { ideas: number; decisions: number };
  /** última coisa que aconteceu: commit ou execução */
  last: { at: Date; text: string } | null;
}

const WEEK = 7 * 86_400_000;
/** dentro do mesmo nível: o que depende de você antes do que é arrumação */
const WEIGHT: Record<Signal['go'], number> = { execucoes: 0, triagem: 1, backlog: 1, producao: 2, projeto: 2, rumo: 3, roadmap: 3 };
const QUERY: Record<Signal['go'], { aba?: string; route?: string }> = {
  triagem: { route: '/triagem' }, execucoes: { route: '/execucoes' }, backlog: { aba: 'backlog' }, rumo: { aba: 'rumo' },
  roadmap: { aba: 'roadmap' }, projeto: {}, producao: { aba: 'producao' },
};

/**
 * Visão geral = saúde dos projetos. Em cima, o que precisa de você (de todos os projetos, o mais grave primeiro);
 * depois um cartão por projeto com a saúde e os porquês, a última atualização, o backlog, o marco de Agora, o rumo e a
 * triagem; embaixo, o que foi feito na semana e os agentes.
 */
@Component({
  selector: 'app-overview-page',
  imports: [RouterLink, Heartbeat, AgoPipe, ProjectAvatar],
  templateUrl: './overview-page.html',
  host: { class: 'block h-full overflow-y-auto' },
})
export class OverviewPage {
  protected readonly projects = inject(ProjectsService);
  protected readonly proposals = inject(ProposalsService);
  protected readonly runs = inject(RunsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly activity = inject(ActivityService);
  private readonly tasks = inject(TasksService);
  private readonly ideas = inject(IdeasService);
  private readonly roadmap = inject(RoadmapService);
  private readonly direction = inject(DirectionService);
  private readonly release = inject(ReleaseService);

  /** a caminho de produção: projetos com algo em develop que não está em main */
  protected readonly shipping = computed(() => this.projects.living().map(p => {
    const repos = (this.release.bySlug()[p.slug] ?? []).filter(r => r.items.length);
    const prs = repos.reduce((n, r) => n + (r.items.filter(i => i.pr).length || r.items.length), 0);
    const oldest = repos.map(r => r.oldestAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return { p, repos: repos.length, prs, oldest, agent: repos.some(r => r.items.some(i => i.delivery)) };
  }).filter(x => x.prs).sort((a, b) => (a.oldest?.getTime() ?? 0) - (b.oldest?.getTime() ?? 0)));

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly runLabel = RUN_STATUS_LABEL;
  protected readonly HEALTH = HEALTH;
  protected readonly order: Health[] = ['risco', 'atencao', 'parado', 'ok'];
  protected readonly days = signal<CommitDay[]>([]);
  protected readonly today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  protected readonly cards = computed<Card[]>(() => {
    const now = Date.now();
    const rumos = this.direction.bySlug();
    return this.projects.living().map(p => {
      const tasks = this.tasks.tasks().filter(t => t.projectSlug === p.slug);
      const open = tasks.filter(t => t.column !== 'done');
      const ms = this.roadmap.of(p.slug, 'now');
      const runs = this.runs.runs().filter(r => r.projectSlug === p.slug);
      const newIdeas = this.ideas.ideas().filter(i => i.projectSlug === p.slug && i.status === 'new').length;
      const rumoAt = rumos[p.slug]?.at ?? null;
      const { health: h, signals } = health({
        status: p.status, folderExists: p.folderExists, lastCommitAt: p.lastCommitAt, dirtyRepos: p.dirtyRepos, openProposals: p.openProposals,
        tasks: open.map(t => ({ column: t.column, priority: t.priority, updatedAt: t.updatedAt, title: t.title })), newIdeas,
        failedRuns7d: runs.filter(r => r.status === 'failed' && r.finishedAt && now - r.finishedAt.getTime() < WEEK).length,
        activeRuns: p.activeRuns, nowMilestones: ms.length, nowWithoutTasks: ms.filter(m => !m.tasks).length, rumoAt,
      }, now);
      const lastRun = runs.find(r => r.finishedAt);
      const commit = p.lastCommitAt ? { at: p.lastCommitAt, text: p.lastCommitSubject ?? 'commit' } : null;
      const run = lastRun?.finishedAt
        ? { at: lastRun.finishedAt, text: lastRun.prompt.includes('[gestor:planejar]') ? 'gestor organizou o backlog' : `agente: ${lastRun.title}` } : null;
      const parent = p.parentSlug ? this.projects.bySlug().get(p.parentSlug) : null;
      return {
        p, name: parent ? `${parent.name} › ${p.name}` : p.name, health: h, signals,
        backlog: { todo: open.filter(t => t.column === 'todo' || t.column === 'backlog').length, doing: open.filter(t => t.column === 'doing').length,
          review: open.filter(t => t.column === 'review').length, dev: open.filter(t => t.column === 'dev').length, urgent: open.filter(t => t.priority === 0).length },
        now: ms[0] ? { title: ms[0].title, done: ms[0].tasksDone, total: ms[0].tasks, more: ms.length - 1 } : null,
        rumoAt, triage: { ideas: newIdeas, decisions: p.openProposals },
        last: commit && run ? (commit.at > run.at ? commit : run) : commit ?? run,
      };
    }).sort((a, b) => HEALTH[a.health].order - HEALTH[b.health].order || a.p.position - b.p.position);
  });

  /** o que precisa de você, de todos os projetos: risco primeiro */
  protected readonly needs = computed(() => this.cards()
    .flatMap(c => c.signals.map(s => ({ ...s, c })))
    .sort((a, b) => (a.level === 'risco' ? 0 : 1) - (b.level === 'risco' ? 0 : 1) || WEIGHT[a.go] - WEIGHT[b.go]));
  protected readonly allNeeds = signal(false);

  protected readonly tally = computed(() => {
    const n = { ok: 0, atencao: 0, risco: 0, parado: 0 } as Record<Health, number>;
    for (const c of this.cards()) n[c.health]++;
    return n;
  });

  protected readonly recentRuns = computed(() => this.runs.runs().slice(0, 5));

  constructor() {
    // recarrega o feed sempre que os projetos mudam (sincronização, novo projeto)
    effect(() => {
      this.projects.projects();
      this.activity.byDay(null, 7, 150).then(d => this.days.set(d));
    });
    // o rumo de cada projeto (data da última revisão)
    effect(() => { for (const p of this.projects.living()) this.direction.ensure(p.slug); });
    this.release.loadAll();
  }

  protected link(s: Signal, slug: string): { route: unknown[]; query: Record<string, string> | null } {
    const q = QUERY[s.go];
    return q.route ? { route: [q.route], query: null } : { route: ['/projetos', slug], query: q.aba ? { aba: q.aba } : null };
  }

  protected color(slug: string): string {
    return this.projects.bySlug().get(slug)?.color ?? 'var(--color-faint)';
  }
}
