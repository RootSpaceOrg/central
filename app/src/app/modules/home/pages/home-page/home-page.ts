import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { WeekPulse } from './components/week-pulse/week-pulse';
import { Welcome } from './components/welcome/welcome';
import { Router, RouterLink } from '@angular/router';

import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { Project } from '../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { Proposal, Verdict } from '../../../../shared/services/proposals/proposals.model';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { DirectionService } from '../../../../shared/services/direction/direction.service';
import { LiveService } from '../../../../shared/services/live/live.service';
import { RoadmapService } from '../../../../shared/services/roadmap/roadmap.service';
import { SessionsService } from '../../../../shared/services/sessions/sessions.service';
import { RoutinesService, describeSchedule } from '../../../../shared/services/routines/routines.service';
import { RUN_STATUS_LABEL } from '../../../../shared/services/runs/runs.model';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { SettingsApiService } from '../../../../shared/services/settings/settings-api.service';
import { Task, TasksService } from '../../../../shared/services/tasks/tasks.service';
import { TurnsService } from '../../../../shared/services/turns/turns.service';
import { UsageService, untilReset } from '../../../../shared/services/usage/usage.service';
import { QuickCommandsService } from '../../../../shared/services/quick-commands/quick-commands.service';
import { DeliveriesService } from '../../../../shared/services/deliveries/deliveries.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { AwayDigest } from './components/away-digest/away-digest';
import { DeliveryCard } from './components/delivery-card/delivery-card';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';

/**
 * Início: o que espera você (revisar, decidir, falhas), o que o piloto automático fez, e os projetos para abrir uma sessão.
 * Sem perguntar o humor: com gás, você abre um projeto; sem gás, a fila já está pronta para aprovar.
 */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink, Icon, AgoPipe, ProjectAvatar, AwayDigest, DeliveryCard, Welcome, WeekPulse],
  templateUrl: './home-page.html',
  host: { class: 'block h-full overflow-y-auto' },
})
export class HomePage {
  protected readonly projects = inject(ProjectsService);
  protected readonly proposals = inject(ProposalsService);
  protected readonly tasks = inject(TasksService);
  protected readonly ideas = inject(IdeasService);
  protected readonly runs = inject(RunsService);
  protected readonly turns = inject(TurnsService);
  protected readonly usage = inject(UsageService);
  protected readonly dialogs = inject(DialogsService);
  protected readonly agents = inject(AgentsService);
  protected readonly direction = inject(DirectionService);
  protected readonly live = inject(LiveService);
  protected readonly roadmap = inject(RoadmapService);
  private readonly sessions = inject(SessionsService);

  /** conversas de sessão e Claude Code no terminal trabalhando agora */
  protected readonly sessionsWorking = computed(() => {
    const out: { key: string; slug: string; title: string; project: string; since: number; step: string | null; subs: number; img: string }[] = [];
    for (const a of this.live.chats()) {
      const c = this.chat.chats().find(x => x.id === a.ref);
      const slug = c?.projectSlug ?? '';
      out.push({ key: `c${a.ref}`, slug, title: c?.title ?? 'Conversa', project: this.project(slug)?.name ?? 'Central', since: a.startedAt,
        step: a.step, subs: this.live.running(a), img: 'file-icons/claude.svg' });
    }
    for (const [id, since] of this.live.terminalsBusy()) {
      const s = this.sessions.byId().get(id);
      if (s) out.push({ key: `t${id}`, slug: s.projectSlug, title: s.title, project: this.project(s.projectSlug)?.name ?? '', since, step: null, subs: 0, img: 'file-icons/claude.svg' });
    }
    return out.sort((a, b) => a.since - b.since);
  });
  protected readonly routines = inject(RoutinesService);
  private readonly chat = inject(ChatService);
  private readonly settings = inject(SettingsApiService);
  private readonly router = inject(Router);

  protected readonly since = signal<Date>(new Date(Date.now() - 86_400_000));
  /** "Enquanto você estava fora": desde o último "Já vi" (no máximo 7 dias) */
  protected readonly awaySince = signal<Date | null>(null);
  protected readonly deliveries = inject(DeliveriesService);
  private readonly quick = inject(QuickCommandsService);
  protected readonly note = signal('');
  protected readonly noteSaved = signal(false);
  protected readonly runLabel = RUN_STATUS_LABEL;
  protected readonly planned = signal<Record<string, number>>({});
  protected readonly reset = untilReset;
  protected readonly schedule = describeSchedule;

  protected readonly greeting = (() => {
    const h = new Date().getHours();
    return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  })();
  protected readonly date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  // ---------- esperando você ----------
  /** terminar antes de começar: PRs prontos primeiro */
  protected readonly reviews = computed(() => {
    // tarefas em revisão que já têm entrega na fila aparecem pela entrega (com a nota)
    const covered = new Set(this.deliveries.queue().map(d => d.taskId).filter(Boolean));
    return this.tasks.tasks().filter(t => t.column === 'review' && !covered.has(t.id)).slice(0, 6);
  });
  protected readonly decide3 = computed(() => this.proposals.inbox().slice(0, 3));
  protected readonly failed = computed(() =>
    this.runs.runs().filter(r => r.status === 'failed' && !r.waiting && r.finishedAt && r.finishedAt > this.since()).slice(0, 3));
  protected readonly waiting = computed(() => this.runs.waiting().length + this.deliveries.queue().length + this.reviews().length + this.proposals.inbox().length + this.ideas.fresh().length + this.failed().length);
  protected readonly finished = computed(() =>
    this.runs.runs().filter(r => r.status === 'succeeded' && r.finishedAt && r.finishedAt > this.since()));

  // ---------- projetos ----------
  private readonly byActivity = (list: Project[]) => [...list].sort((a, b) => (b.lastCommitAt?.getTime() ?? 0) - (a.lastCommitAt?.getTime() ?? 0));
  protected readonly evolving = computed(() => this.byActivity(this.projects.living().filter(p => p.status === 'active')));
  protected readonly supporting = computed(() => this.byActivity(this.projects.living().filter(p => p.status === 'maintenance')));

  // ---------- automações ----------
  protected readonly automations = computed(() => this.routines.routines().filter(r => r.enabled));

  protected readonly advice = computed(() => {
    const s = this.usage.session();
    if (!s) return null;
    const left = 100 - s.percent;
    if (left >= 50) return { tone: 'text-yes', text: 'Sobra cota: bom momento para mandar tarefas para agentes.' };
    if (left >= 20) return { tone: 'text-later', text: 'Cota pela metade: prefira tarefas pequenas ou revise PRs.' };
    return { tone: 'text-no', text: `Sessão quase no fim. Reinicia em ${untilReset(s.resetsAt)}: hora de revisar e decidir.` };
  });

  constructor() {
    // rumo de cada projeto vivo para os cartões
    effect(() => { for (const p of this.projects.living()) untracked(() => this.direction.ensure(p.slug)); });
    this.settings.get('home:lastSeen').then(v => {
      if (v) this.since.set(new Date(v));
      this.settings.set('home:lastSeen', new Date().toISOString());
    });
    this.settings.get('home:awaySeen').then(v => {
      const week = Date.now() - 7 * 86_400_000;
      this.awaySince.set(new Date(Math.max(v ? Date.parse(v) : Date.now() - 86_400_000, week)));
    });
  }

  /** agente que parou esperando: rodar o comando que ele pediu (terminal no projeto) */
  protected runFix(command: string, slug: string | null): void {
    this.quick.inTerminal(command, slug, 'shell', true).catch(e => this.quick.error.set((e as Error).message));
  }

  /** você resolveu: o agente continua de onde parou (abre a conversa no painel) */
  protected async resume(runId: number): Promise<void> {
    try { const chat = await this.runs.resume(runId); if (chat) this.chat.openInPanel(chat); }
    catch (e) { this.quick.error.set((e as Error).message); }
  }

  protected agentName(id: number | null): string { return (id ? this.agents.byId().get(id)?.name : null) ?? 'O agente'; }

  /** "Já vi": o resumo recomeça a partir de agora */
  protected markSeen(): void {
    const now = new Date();
    this.settings.set('home:awaySeen', now.toISOString());
    this.awaySince.set(now);
  }

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected decide(p: Proposal, v: Verdict): void { this.proposals.decide(p, v); }

  /** sessão nova no projeto: conversa com o Claude ou terminal */
  protected session(slug: string, kind: 'chat' | 'shell'): void {
    this.router.navigate(['/projetos', slug], { queryParams: { nova: kind } });
  }

  protected talk(agentId: number): void {
    this.chat.talkTo(agentId);
  }

  /** conversa sobre o PR em revisão, no projeto */
  protected review(t: Task): void {
    if (t.prUrl) this.projects.openExternal(t.prUrl);
    else this.dialogs.editTask(t.id);
  }

  /** primeira linha útil do rumo (sem markdown), para o cartão do projeto */
  protected rumo(slug: string): string | null {
    const d = this.direction.bySlug()[slug];
    if (!d) return null;
    return d.text.split('\n').map(l => l.replace(/[*#>_`-]/g, '').trim()).filter(Boolean).slice(0, 2).join(' · ');
  }

  protected waitingOf(slug: string): number { return this.ideas.waiting().filter(i => i.projectSlug === slug).length; }

  protected async plan(slug: string): Promise<void> {
    try { const id = await this.direction.plan(slug); this.planned.update(m => ({ ...m, [slug]: id })); }
    catch (e) { alert((e as Error).message); }
  }

  protected async saveNote(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.note().trim()) return;
    await this.ideas.create(this.note().trim(), '', null);
    this.note.set('');
    this.noteSaved.set(true);
    setTimeout(() => this.noteSaved.set(false), 2500);
  }
}
