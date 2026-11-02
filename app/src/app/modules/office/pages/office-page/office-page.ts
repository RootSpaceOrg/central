import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Agent, AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { LiveService, PlanItem, Subagent, doing, elapsed } from '../../../../shared/services/live/live.service';
import { Project } from '../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RoadmapService } from '../../../../shared/services/roadmap/roadmap.service';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { SessionsService } from '../../../../shared/services/sessions/sessions.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { AvatarSource, ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { Icon } from '../../../../shared/ui/icon';

/** Alguém trabalhando agora: uma mesa no escritório. */
interface Worker {
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
  open: () => void;
}

/** Uma sala: um projeto (ou a sala da Central) com as mesas de quem está trabalhando nele. */
interface Room { slug: string | null; project: Project | null; workers: Worker[] }

const GESTOR = '[gestor:planejar]';

/**
 * Escritório: o time trabalhando, como se fosse um andar. Cada projeto com alguém trabalhando é uma sala (com o marco de
 * "Agora" na parede); cada sessão ou execução é uma mesa com o que está fazendo, o plano que declarou e os subagentes
 * (estagiários). Quem está parado fica na copa; quem saiu há pouco aparece com o resultado. Tudo com o que já chega ao vivo.
 */
@Component({
  selector: 'app-office-page',
  imports: [RouterLink, Icon, ProjectAvatar, AgoPipe],
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

  protected readonly since = elapsed;

  protected readonly workers = computed<Worker[]>(() => {
    const out: Worker[] = [];
    const agentOf = (id: number | null): Agent | null => (id ? this.agents.byId().get(id) ?? null : null);
    for (const a of this.live.chats()) {
      const c = this.chat.chats().find(x => x.id === a.ref);
      const agent = agentOf(c?.agentId ?? null);
      const slug = c?.projectSlug ?? agent?.projectSlug ?? null;
      const session = this.sessions.all().find(s => s.chatId === a.ref);
      out.push({
        key: `c${a.ref}`, slug, name: c?.projectSlug ? 'Claude' : agent?.name ?? 'Central', role: c?.projectSlug ? 'Sessão' : 'Conversa',
        title: c?.title ?? 'Conversa', avatar: c?.projectSlug ? null : agent, img: c?.projectSlug ? 'file-icons/claude.svg' : null,
        since: a.startedAt, doing: doing(a), plan: a.plan, subagents: a.subagents,
        open: () => (session ? this.openSession(session.projectSlug, session.id) : this.chat.openInPanel(a.ref)),
      });
    }
    for (const a of this.live.runs()) {
      const r = this.runs.runs().find(x => x.id === a.ref);
      const agent = agentOf(r?.agentId ?? null);
      const gestor = r?.prompt.includes(GESTOR);
      out.push({
        key: `r${a.ref}`, slug: r?.projectSlug ?? agent?.projectSlug ?? null, name: gestor ? 'Gestor do projeto' : agent?.name ?? 'Agente',
        role: gestor ? 'Planejando o backlog' : `Execução #${a.ref}${r?.taskId ? ` · tarefa #${r.taskId}` : ''}`,
        title: gestor ? 'Organizando o backlog pelo rumo' : r?.title ?? `Execução #${a.ref}`, avatar: agent, img: agent ? null : 'file-icons/claude.svg',
        since: a.startedAt, doing: doing(a), plan: a.plan, subagents: a.subagents,
        open: () => this.router.navigate(['/execucoes'], { queryParams: { run: a.ref } }),
      });
    }
    for (const [id, since] of this.live.terminalsBusy()) {
      const s = this.sessions.byId().get(id);
      if (!s) continue;
      out.push({
        key: `t${id}`, slug: s.projectSlug, name: 'Claude Code', role: 'Terminal', title: s.title, avatar: null, img: 'file-icons/claude.svg',
        since, doing: 'Trabalhando no terminal', plan: [], subagents: [], open: () => this.openSession(s.projectSlug, s.id),
      });
    }
    return out.sort((a, b) => a.since - b.since);
  });

  protected readonly rooms = computed<Room[]>(() => {
    const m = new Map<string | null, Worker[]>();
    for (const w of this.workers()) m.set(w.slug, [...(m.get(w.slug) ?? []), w]);
    return [...m].map(([slug, workers]) => ({ slug, project: slug ? this.projects.bySlug().get(slug) ?? null : null, workers }))
      .sort((a, b) => b.workers.length - a.workers.length);
  });

  /** salas sem ninguém agora: só a porta (com o marco atual) */
  protected readonly quiet = computed(() => {
    const busy = new Set(this.rooms().map(r => r.slug));
    return this.projects.living().filter(p => !busy.has(p.slug) && !p.parentSlug);
  });

  /** agentes parados (copa) */
  protected readonly idle = computed(() => {
    const working = new Set(this.workers().map(w => w.avatar).filter(Boolean));
    return this.agents.agents().filter(a => !working.has(a));
  });

  /** saíram há pouco (últimas 3 h): resultado e quanto levou */
  protected readonly recent = computed(() => {
    const since = this.live.now() - 3 * 3_600_000;
    return this.runs.runs().filter(r => r.finishedAt && r.finishedAt.getTime() > since && r.status !== 'killed').slice(0, 8);
  });

  protected readonly subsRunning = computed(() => this.workers().reduce((n, w) => n + w.subagents.filter(s => !s.finishedAt).length, 0));

  protected planDone(w: Worker): number { return w.plan.filter(p => p.status === 'completed').length; }

  protected agentName(id: number | null): string { return (id ? this.agents.byId().get(id)?.name : null) ?? 'Agente'; }

  protected openSession(slug: string, sessionId: number): void {
    this.sessions.select(slug, sessionId);
    this.router.navigate(['/projetos', slug]);
  }
}
