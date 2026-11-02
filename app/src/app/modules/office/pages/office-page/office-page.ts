import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Agent, AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { AgentStatus, LiveActivity, LiveService, PHASES, Phase, PlanItem, Subagent, doing, elapsed } from '../../../../shared/services/live/live.service';
import { TasksService } from '../../../../shared/services/tasks/tasks.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RoadmapService } from '../../../../shared/services/roadmap/roadmap.service';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { SessionsService } from '../../../../shared/services/sessions/sessions.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { AvatarSource, ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { Icon } from '../../../../shared/ui/icon';
import { ROOM, RoomId, inferRoom } from '../../office-map';
import { OfficeScene, Person } from './components/office-scene/office-scene';

/** Alguém trabalhando agora: uma mesa no escritório. */
interface Worker {
  /** chave no mapa: o 1º trabalho de um agente usa a chave do agente (sai da copa e anda até a mesa) */
  key: string;
  slug: string | null;
  name: string;
  role: string;
  title: string;
  avatar: AvatarSource | null;
  img: string | null;
  since: number;
  doing: string | null;
  plan: PlanItem[];
  subagents: Subagent[];
  room: RoomId;
  agentId: number | null;
  /** cor do cabelo (agente) */
  hair: string;
  /** etapa (declarada ou deduzida) e o que o agente disse (set_status) */
  phase: Phase | null;
  status: AgentStatus | null;
  /** tarefa do backlog em que está ("#12 Exportar roadmap") */
  task: string | null;
  open: () => void;
}

const GESTOR = '[gestor:planejar]';
const FILTER_KEY = 'central.office.filter';
const CLAUDE = '#D97757';

/** Sala de um agente: a que ele escolheu, ou deduzida pelo papel (a Central fica na gestão). */
export function agentRoom(a: Agent): RoomId {
  return (a.room as RoomId) || (a.builtin ? 'gestao' : inferRoom(`${a.name} ${a.description ?? ''} ${a.tools.join(' ')}`));
}

/**
 * Escritório: o time trabalhando, como um andar em isométrico. Salas por tipo de trabalho (gestão, engenharia,
 * monitoração, criativo, negócios); cada sessão ou execução senta numa mesa com um balão do que está fazendo e o plano
 * que declarou, com os subagentes (estagiários) em volta. Quem está parado fica na copa e anda pelo corredor até a sala
 * quando começa. Abaixo: o detalhe de cada mesa, o mural do corredor (marcos de Agora) e quem saiu há pouco.
 */
@Component({
  selector: 'app-office-page',
  imports: [RouterLink, Icon, ProjectAvatar, AgoPipe, OfficeScene],
  templateUrl: './office-page.html',
  host: { class: 'block h-full overflow-y-auto office-floor' },
})
export class OfficePage {
  protected readonly live = inject(LiveService);
  protected readonly roadmap = inject(RoadmapService);
  private readonly projects = inject(ProjectsService);
  private readonly chat = inject(ChatService);
  private readonly runs = inject(RunsService);
  private readonly sessions = inject(SessionsService);
  private readonly agents = inject(AgentsService);
  private readonly router = inject(Router);
  private readonly tasks = inject(TasksService);

  protected readonly phases = PHASES;

  protected readonly since = elapsed;
  protected readonly roomLabel = (id: RoomId) => ROOM.get(id)?.label ?? '';

  protected readonly workers = computed<Worker[]>(() => {
    const list: (Omit<Worker, 'key'> & { own: string })[] = [];
    const agentOf = (id: number | null): Agent | null => (id ? this.agents.byId().get(id) ?? null : null);
    for (const a of this.live.chats()) {
      const c = this.chat.chats().find(x => x.id === a.ref);
      const agent = agentOf(c?.agentId ?? null);
      const inProject = !!c?.projectSlug;
      const session = this.sessions.all().find(s => s.chatId === a.ref);
      list.push({
        own: `c${a.ref}`, slug: c?.projectSlug ?? agent?.projectSlug ?? null,
        name: inProject ? 'Claude' : agent?.name ?? 'Central', role: inProject ? 'Sessão' : 'Conversa',
        title: c?.title ?? 'Conversa', avatar: inProject ? null : agent, img: inProject || !agent ? 'file-icons/claude.svg' : null,
        since: a.startedAt, doing: doing(a), plan: a.plan, subagents: a.subagents, ...this.state(a, null),
        room: inProject ? 'eng' : agent ? agentRoom(agent) : 'gestao', agentId: inProject ? null : agent?.id ?? null,
        hair: inProject ? CLAUDE : agent?.color ?? '#E8C46A',
        open: () => (session ? this.openSession(session.projectSlug, session.id) : this.chat.openInPanel(a.ref)),
      });
    }
    for (const a of this.live.runs()) {
      const r = this.runs.runs().find(x => x.id === a.ref);
      const agent = agentOf(r?.agentId ?? null);
      const gestor = !!r?.prompt.includes(GESTOR);
      list.push({
        own: `r${a.ref}`, slug: r?.projectSlug ?? agent?.projectSlug ?? null, name: gestor ? 'Gestor do projeto' : agent?.name ?? 'Agente',
        role: gestor ? 'Planejando o backlog' : `Execução #${a.ref}${r?.taskId ? ` · tarefa #${r.taskId}` : ''}`,
        title: gestor ? 'Organizando o backlog pelo rumo' : r?.title ?? `Execução #${a.ref}`, avatar: agent, img: agent ? null : 'file-icons/claude.svg',
        since: a.startedAt, doing: doing(a), plan: a.plan, subagents: a.subagents, ...this.state(a, r?.taskId ?? null),
        room: gestor ? 'gestao' : agent ? agentRoom(agent) : 'eng', agentId: agent?.id ?? null, hair: agent?.color ?? CLAUDE,
        open: () => this.router.navigate(['/execucoes'], { queryParams: { run: a.ref } }),
      });
    }
    for (const [id, since] of this.live.terminalsBusy()) {
      const s = this.sessions.byId().get(id);
      if (!s) continue;
      list.push({
        own: `t${id}`, slug: s.projectSlug, name: 'Claude Code', role: 'Terminal', title: s.title, avatar: null, img: 'file-icons/claude.svg',
        since, doing: 'Trabalhando no terminal', plan: [], subagents: [], phase: null, status: null, task: null, room: 'eng', agentId: null, hair: CLAUDE,
        open: () => this.openSession(s.projectSlug, s.id),
      });
    }
    const used = new Set<number>();
    return list.sort((a, b) => a.since - b.since).map(({ own, ...w }) => {
      const first = w.agentId !== null && !used.has(w.agentId);
      if (first) used.add(w.agentId!);
      return { ...w, key: first ? `a${w.agentId}` : own };
    });
  });

  /** agentes parados (copa) */
  protected readonly idle = computed(() => {
    const working = new Set(this.workers().map(w => w.agentId));
    return this.agents.agents().filter(a => !working.has(a.id));
  });

  // ---------- filtro por projeto (frente conta como o projeto-pai; '' = sem projeto) ----------
  protected readonly filter = signal<ReadonlySet<string>>(new Set(JSON.parse(localStorage.getItem(FILTER_KEY) ?? '[]') as string[]));
  private readonly topOf = (slug: string | null) => (slug ? this.projects.bySlug().get(slug)?.parentSlug ?? slug : '');
  private readonly shown = (slug: string | null) => !this.filter().size || this.filter().has(this.topOf(slug));
  protected readonly visible = computed(() => this.workers().filter(w => this.shown(w.slug)));
  /** chips: projetos de cima + "sem projeto", com quantos trabalhando */
  protected readonly chips = computed(() => {
    const count = new Map<string, number>();
    for (const w of this.workers()) count.set(this.topOf(w.slug), (count.get(this.topOf(w.slug)) ?? 0) + 1);
    return [
      ...this.projects.living().filter(p => !p.parentSlug).map(p => ({ id: p.slug, label: p.name, project: p, n: count.get(p.slug) ?? 0 })),
      { id: '', label: 'Sem projeto', project: null, n: count.get('') ?? 0 },
    ];
  });

  protected toggle(id: string | null): void {
    const next = new Set(id === null ? [] : this.filter());
    if (id !== null) { if (next.has(id)) next.delete(id); else next.add(id); }
    this.filter.set(next);
    localStorage.setItem(FILTER_KEY, JSON.stringify([...next]));
  }

  /** quem senta em cada sala (legenda do 3D) */
  protected readonly members = computed(() => {
    const out: Partial<Record<RoomId, string[]>> = {};
    for (const a of this.agents.agents()) (out[agentRoom(a)] ??= []).push(a.name);
    (out.eng ??= []).push('sessões dos projetos');
    return out;
  });

  /** quem está no andar */
  protected readonly people = computed<Person[]>(() => {
    const projectOf = (slug: string | null) => (slug ? this.projects.bySlug().get(slug) ?? null : null);
    const out: Person[] = this.workers().map(w => {
      const p = projectOf(w.slug);
      return {
        key: w.key, room: w.room, name: w.name, hair: w.hair, shirt: p?.color ?? '#6b7385', working: true,
        doing: w.phase ? `${PHASES[w.phase].label} · ${w.doing ?? 'pensando…'}` : w.doing,
        tag: p?.name ?? null, plan: w.plan.length ? [this.planDone(w), w.plan.length] : null, subs: w.subagents.filter(x => !x.finishedAt).length,
        hidden: !this.shown(w.slug),
      };
    });
    for (const a of this.idle()) {
      const p = projectOf(a.projectSlug);
      out.push({ key: `a${a.id}`, room: 'copa', name: a.name, hair: a.color, shirt: p?.color ?? '#6b7385', working: false, doing: null, tag: p?.name ?? null, plan: null, subs: 0, hidden: !this.shown(a.projectSlug) });
    }
    return out;
  });

  protected readonly selected = signal<string | null>(null);

  /** post-its no quadro da gestão: um por marco em Agora, na cor do projeto */
  protected readonly nowColors = computed(() => this.roadmap.all().filter(m => m.horizon === 'now')
    .map(m => this.projects.bySlug().get(m.projectSlug)?.color ?? '#E8C46A'));

  /** salas sem ninguém agora: o mural do corredor (com o marco atual) */
  protected readonly quiet = computed(() => {
    const busy = new Set(this.workers().map(w => w.slug));
    return this.projects.living().filter(p => !busy.has(p.slug) && !p.parentSlug);
  });

  /** saíram há pouco (últimas 3 h): resultado e quanto levou */
  protected readonly recent = computed(() => {
    const since = this.live.now() - 3 * 3_600_000;
    return this.runs.runs().filter(r => r.finishedAt && r.finishedAt.getTime() > since && r.status !== 'killed').slice(0, 8);
  });

  protected readonly subsRunning = computed(() => this.workers().reduce((n, w) => n + w.subagents.filter(s => !s.finishedAt).length, 0));

  /** etapa, status declarado e a tarefa (a que o agente disse, ou a da execução) */
  private state(a: LiveActivity, runTask: number | null): Pick<Worker, 'phase' | 'status' | 'task'> {
    const id = a.status?.taskId ?? runTask;
    const title = a.status?.taskTitle ?? (id ? this.tasks.tasks().find(t => t.id === id)?.title : null);
    return { phase: a.phase, status: a.status, task: id ? `#${id}${title ? ` ${title}` : ''}` : null };
  }

  protected phaseOf(w: Worker) { return w.phase ? PHASES[w.phase] : { label: 'Começando', color: '#9aa3b5' }; }

  protected running(w: Worker): number { return w.subagents.filter(s => !s.finishedAt).length; }

  protected planDone(w: Worker): number { return w.plan.filter(p => p.status === 'completed').length; }

  protected agentName(id: number | null): string { return (id ? this.agents.byId().get(id)?.name : null) ?? 'Agente'; }

  protected projectName(slug: string | null): string | null { return slug ? this.projects.bySlug().get(slug)?.name ?? null : null; }

  /** clicou numa pessoa no mapa: seleciona e mostra a mesa dela na lista */
  protected pick(key: string | null): void {
    this.selected.set(!key || this.selected() === key ? null : key);
    if (!key) return;
    queueMicrotask(() => document.getElementById(`desk-${key}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  protected openKey(key: string): void {
    const w = this.workers().find(x => x.key === key);
    if (w) w.open();
    else if (key.startsWith('a')) this.router.navigate(['/agentes'], { queryParams: { agente: key.slice(1) } });
  }

  protected openSession(slug: string, sessionId: number): void {
    this.sessions.select(slug, sessionId);
    this.router.navigate(['/projetos', slug]);
  }
}
