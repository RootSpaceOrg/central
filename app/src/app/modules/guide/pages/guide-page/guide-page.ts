import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ChatView } from '../../../../shared/components/chat-view/chat-view';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { ScopeService } from '../../../../shared/services/scope/scope.service';
import { TasksService } from '../../../../shared/services/tasks/tasks.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { MarkdownPipe, RefsPipe } from '../../../../shared/ui/markdown';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { Guide, GuideCard, GuidePlanItem, GuidesService } from '../../services/guides/guides.service';

const STEPS = [
  { n: 1, label: 'Retrato' },
  { n: 2, label: 'Decisões' },
  { n: 3, label: 'Plano' },
  { n: 4, label: 'Em andamento' },
];
const KIND: Record<string, string> = {
  rumo: 'Rumo e roadmap', direcao: 'Direção', prioridade: 'Priorizar e cortar', time: 'Time', fluxo: 'Fluxo (quadros)', rotina: 'Rotinas',
};
/** textos de cada tipo de sessão (mesma tela, mesmo motor) */
const TEXT = {
  rumo: {
    title: 'Rumo', icon: 'compass' as const, subtitle: 'Retrato do projeto, debate entre o estrategista e a Central, suas decisões e o plano que os agentes executam.',
    specialist: 'estrategista', Specialist: 'Estrategista', startTitle: 'Para onde vamos agora?', startButton: 'Guiar este projeto', step1: 'Retrato', reading: 'Leitura do momento',
    startBody: 'O estrategista lê o projeto inteiro (rumo, roadmap, backlog, ideias, decisões, o que andou e o que espera produção) e abre o debate. A Central responde e monta as decisões para você. Usa Opus nos dois.',
    analysing: 'O estrategista está lendo o projeto e vai abrir o debate na conversa ao lado…',
    hints: { agora: 'agente começa já', backlog: 'tarefa em A fazer', depois: 'marco ou ideia' },
    placeholder: 'ex.: acho que precisamos focar em x, y e z. O que te preocupa, o que você quer validar, o que talvez devesse ser cortado…',
    suggestions: ['Validar se o rumo ainda vale', 'O que devemos cortar?', 'Estamos prontos para ir para produção?', 'O que está travando a entrega?', 'Qual o próximo marco que mais importa?'],
    reads: [
      { icon: 'flag' as const, label: 'Rumo e roadmap', hint: 'o que você escreveu e os marcos de Agora e Próximo' },
      { icon: 'kanban' as const, label: 'Backlog', hint: 'tarefas por coluna e o que está parado' },
      { icon: 'ideas' as const, label: 'Ideias e decisões', hint: 'novas, aprovadas paradas e o que espera você' },
      { icon: 'activity' as const, label: 'Trabalho recente', hint: 'execuções e entregas da semana' },
      { icon: 'pr' as const, label: 'Produção', hint: 'o que está em develop esperando a main' },
    ],
    planHelp: 'Agora: um agente começa já. Backlog: tarefa em A fazer com o agente. Depois: vira marco ou ideia.',
  },
  agencia: {
    title: 'Time', icon: 'users' as const, subtitle: 'O time de agentes do projeto: quem faz o quê, os fluxos e as rotinas, revisados pelo diretor de agência e a Central.',
    specialist: 'diretor de agência', Specialist: 'Diretor', startTitle: 'O time dá conta desse rumo?', startButton: 'Revisar a agência', step1: 'Retrato do time', reading: 'Leitura do time',
    startBody: 'O diretor de agência lê o rumo, o roadmap, o backlog e como cada agente tem trabalhado, e propõe o time (papéis, quadros e rotinas). A Central responde e monta as decisões. Usa Opus nos dois.',
    analysing: 'O diretor de agência está lendo o time e vai abrir o debate na conversa ao lado…',
    hints: { agora: 'aplica já', backlog: 'vira tarefa', depois: 'vira ideia' },
    placeholder: 'ex.: quero um time enxuto focado em x; sinto que falta alguém para y; o agente z erra sempre em…',
    suggestions: ['Quero um time enxuto', 'Falta algum papel?', 'Quem está falhando e por quê?', 'O A fazer tem dono certo?', 'Que rotina sobra ou falta?'],
    reads: [
      { icon: 'agent' as const, label: 'Time', hint: 'cada agente, papel, modelo e liberdade' },
      { icon: 'activity' as const, label: 'Desempenho', hint: 'entregas, falhas e custo da semana por agente' },
      { icon: 'workflow' as const, label: 'Fluxos', hint: 'quadros e o agente de cada etapa' },
      { icon: 'routine' as const, label: 'Rotinas', hint: 'o que roda sozinho e quando' },
      { icon: 'flag' as const, label: 'Rumo e último Guiar', hint: 'para onde o projeto vai' },
    ],
    planHelp: 'Agora: a Central cria ou muda já. Backlog: vira tarefa para depois. Depois: fica anotado como ideia.',
  },
};
type TeamAgent = { id: number; name: string; role: string | null; model: string; freedom: string; central: boolean; runs_7d: { succeeded: number; failed: number; active: number };
  cost_7d_usd: number; last_run: string | null; todo_owner: boolean; boards: string[]; routines: string[] };
export interface Team { agents: TeamAgent[]; boards: { name: string; stages: string[] }[]; routines: { name: string; agent: string | null; enabled: boolean; when: string; kind: string }[];
  todo_owner: string | null; backlog: { backlog: number; todo: number; doing: number; stale_14d: number; waiting_you: number } }
const ITEM_KIND: Record<string, string> = {
  rumo: 'rumo', marco: 'marco', tarefa: 'tarefa', ideia: 'ideia', cortar: 'cortar', agente: 'agente', agencia: 'para a Agência',
  criar_agente: 'novo agente', ajustar_agente: 'ajustar agente', aposentar_agente: 'aposentar', quadro: 'quadro', rotina: 'rotina', dono_todo: 'dono do A fazer',
};
const WHEN: { id: GuidePlanItem['when']; label: string }[] = [{ id: 'agora', label: 'Agora' }, { id: 'backlog', label: 'Backlog' }, { id: 'depois', label: 'Depois' }];

/**
 * Guiar projeto: "para onde vamos agora?". O projeto vem da barra lateral. Etapas no centro (retrato → decisões → plano →
 * em andamento) e, à direita, a conversa com o debate (estrategista e Central).
 */
@Component({
  selector: 'app-guide-page',
  imports: [NgTemplateOutlet, RouterLink, Icon, ChatView, MarkdownPipe, RefsPipe, AgoPipe, ProjectAvatar],
  templateUrl: './guide-page.html',
  host: { class: '@container block h-full' },
})
export class GuidePage {
  protected readonly guides = inject(GuidesService);
  /** tipo da sessão: vem da rota (/guiar = rumo, /agencia = agencia) */
  protected readonly kind: 'rumo' | 'agencia' = inject(ActivatedRoute).snapshot.data['kind'] ?? 'rumo';
  protected readonly t = TEXT[this.kind];
  /** ?foco= (vindo do Guiar: "Levar para a Agência") já preenche o compositor */
  private readonly initialFocus = inject(ActivatedRoute).snapshot.queryParamMap.get('foco');
  protected readonly scope = inject(ScopeService);
  protected readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly runs = inject(RunsService);
  private readonly tasks = inject(TasksService);
  private readonly chat = inject(ChatService);

  protected readonly steps = STEPS;
  protected readonly kindLabel = KIND;
  protected readonly itemKind = ITEM_KIND;
  protected readonly whens = WHEN;
  protected readonly starting = signal(false);
  protected readonly question = signal('');
  /** "precisamos focar em x, y e z": antes de começar e com a sessão aberta */
  protected readonly focusText = signal(this.initialFocus ?? '');
  protected readonly sendingFocus = signal(false);
  protected readonly asking = signal(false);

  /** o que está escolhido na barra lateral */
  protected readonly slug = computed(() => this.scope.slug());
  protected readonly project = computed(() => this.scope.project());
  protected readonly guide = computed(() => (this.slug() ? this.guides.openFor(this.slug()!, this.scope.direct(), this.kind) : null));
  protected readonly history = computed(() => this.guides.guides().filter(g => g.kind === this.kind && g.status === 'done' && (!this.slug() || this.scope.matches(g.projectSlug))));
  /** sem projeto escolhido: projetos vivos de cima, com a sessão aberta (se houver) */
  protected readonly choices = computed(() => this.projects.living().filter(p => !p.parentSlug).map(p => ({ p, open: this.guides.open().find(g => g.projectSlug === p.slug && g.kind === this.kind) ?? null })));

  /** a conversa do debate (a da Central) */
  protected readonly session = this.chat.spawn(null);
  protected readonly strategistBusy = computed(() => { const g = this.guide(); return !!g?.strategistChat && this.chat.busy().has(g.strategistChat); });
  protected readonly centralBusy = computed(() => { const g = this.guide(); return !!g?.centralChat && this.chat.busy().has(g.centralChat); });
  protected readonly working = computed(() => this.guide()?.phase !== 'idle' || this.strategistBusy() || this.centralBusy());

  constructor() {
    inject(DestroyRef).onDestroy(() => this.chat.release(this.session));
    effect(() => {
      const id = this.guide()?.centralChat ?? null;
      const central = this.agents.central();
      untracked(() => {
        if (central) this.session.agentId.set(central.id);
        if (this.session.current() !== id) this.session.select(id);
      });
    });
  }

  protected date(v: string): Date { return new Date(v); }
  protected agentById(id: number) { return this.agents.byId().get(id) ?? null; }
  protected projectOf(slug: string) { return this.projects.bySlug().get(slug) ?? null; }
  protected nameOf(g: Guide): string { const p = this.projectOf(g.projectSlug); return `${p?.name ?? g.projectSlug}${g.direct ? ' (sem frente)' : ''}`; }

  protected addSuggestion(s: string): void { this.focusText.update(v => (v.trim() ? `${v.trimEnd()}\n` : '') + s); }

  protected async start(): Promise<void> {
    const s = this.slug();
    if (!s) return;
    this.starting.set(true);
    await this.guides.start(s, this.scope.direct(), this.focusText().trim() || null, this.kind);
    this.focusText.set('');
    this.starting.set(false);
  }

  protected go(g: Guide, step: number): void { if (step <= this.maxStep(g)) this.guides.step(g.id, step); }
  /** até onde dá para ir: retrato sempre; decisões quando há cards; plano quando há plano; em andamento depois de aprovar */
  protected maxStep(g: Guide): number { return g.approvedAt ? 4 : g.plan.length ? 3 : g.cards.length ? 2 : 1; }

  protected pick(g: Guide, c: GuideCard, i: number): void { this.guides.answer(g.id, c.id, { choice: c.answer?.choice === i ? null : i, note: c.answer?.note ?? '' }); }
  protected note(g: Guide, c: GuideCard, note: string): void { this.guides.answer(g.id, c.id, { choice: c.answer?.choice ?? null, note }); }
  protected answered(g: Guide): number { return g.cards.filter(c => c.answer && (c.answer.choice != null || c.answer.note.trim())).length; }
  protected included(g: Guide): number { return g.plan.filter(p => p.include).length; }

  protected async ask(g: Guide, about?: GuideCard): Promise<void> {
    const q = about ? `Sobre o card "${about.question}": ${this.question().trim() || 'qual caminho você escolheria e por quê?'}` : this.question().trim();
    this.asking.set(true);
    await this.guides.ask(g.id, q);
    this.asking.set(false);
    this.question.set('');
  }

  protected async sendFocus(g: Guide): Promise<void> {
    const t = this.focusText().trim();
    if (!t) return;
    this.sendingFocus.set(true);
    const ok = await this.guides.focus(g.id, t);
    this.sendingFocus.set(false);
    if (ok !== null) this.focusText.set('');
  }

  /** plano aprovado em três colunas (agora, backlog, depois) */
  protected columns(g: Guide) {
    const inc = g.plan.filter(p => p.include);
    return [
      { id: 'agora', label: 'Agora', hint: this.t.hints.agora, tone: 'text-yes', items: inc.filter(p => p.when === 'agora') },
      { id: 'backlog', label: 'Backlog', hint: this.t.hints.backlog, tone: 'text-frost', items: inc.filter(p => p.when === 'backlog') },
      { id: 'depois', label: 'Depois', hint: this.t.hints.depois, tone: 'text-mute', items: inc.filter(p => p.when === 'depois') },
    ];
  }
  /** tarefas do escopo que andaram desde a aprovação */
  protected readonly movedTasks = computed(() => {
    const g = this.guide();
    if (!g?.approvedAt) return [];
    const t = g.approvedAt.getTime();
    return this.tasks.tasks().filter(x => this.scope.matches(x.projectSlug) && x.updatedAt.getTime() >= t).slice(0, 20);
  });
  protected readonly colLabel: Record<string, string> = { backlog: 'Backlog', todo: 'A fazer', doing: 'Fazendo', review: 'Revisão', dev: 'Em dev', done: 'Feito' };
  protected readonly kindTone: Record<string, string> = {
    rumo: 'bg-[#C8A2FF]/15 text-[#C8A2FF]', marco: 'bg-later/15 text-later', tarefa: 'bg-frost/15 text-frost',
    ideia: 'bg-yes/15 text-yes', cortar: 'bg-no/15 text-no', agente: 'bg-frost/15 text-frost',
    criar_agente: 'bg-yes/15 text-yes', ajustar_agente: 'bg-frost/15 text-frost', aposentar_agente: 'bg-no/15 text-no', quadro: 'bg-[#C6A6FF]/15 text-[#C6A6FF]',
    rotina: 'bg-later/15 text-later', dono_todo: 'bg-frost/15 text-frost', agencia: 'bg-[#7ED6C2]/15 text-[#7ED6C2]',
  };

  /** Guiar → Agência: o que o rumo pede de time vira o foco da sessão de Agência */
  protected forAgency(g: Guide): string {
    return g.plan.filter(p => p.kind === 'agencia' && p.include).map(p => `- ${p.title}${p.detail ? `: ${p.detail}` : ''}`).join('\n');
  }

  protected abandon(g: Guide): void { if (confirm('Descartar esta sessão? A conversa fica no histórico do agente.')) this.guides.abandon(g.id); }

  // ---------- agência: o time ao vivo (sem sessão) e as revisões automáticas ----------
  protected readonly liveTeam = signal<Team | null>(null);
  protected readonly auto = signal<{ daily: boolean; weekly: boolean } | null>(null);
  private readonly loadTeam = effect(() => {
    const s = this.slug(), direct = this.scope.direct();
    if (this.kind !== 'agencia' || !s) { this.liveTeam.set(null); this.auto.set(null); return; }
    this.guides.team(s, direct).then(t => this.liveTeam.set(t as unknown as Team), () => this.liveTeam.set(null));
    this.guides.routines(s).then(r => this.auto.set(r));
  });
  protected async setAuto(patch: Partial<{ daily: boolean; weekly: boolean }>): Promise<void> {
    const s = this.slug(), cur = this.auto();
    if (!s || !cur) return;
    const r = await this.guides.setRoutines(s, { ...cur, ...patch });
    if (r) this.auto.set(r);
  }
  protected team(g: Guide): Team { return g.snapshot as unknown as Team; }

  /** etapa 4: o que nasceu depois de aprovar (execuções do projeto desde então) */
  protected readonly since = computed(() => {
    const g = this.guide();
    if (!g?.approvedAt) return [];
    const t = g.approvedAt.getTime();
    return this.runs.runs().filter(r => this.scope.matches(r.projectSlug) && r.createdAt.getTime() >= t).slice(0, 20);
  });

  protected tiles(g: Guide) {
    const s = g.snapshot;
    return [
      { label: 'Tarefas abertas', value: (s.tasks?.backlog ?? 0) + (s.tasks?.todo ?? 0) + (s.tasks?.doing ?? 0), hint: `${s.tasks?.todo ?? 0} a fazer · ${s.tasks?.doing ?? 0} fazendo` },
      { label: 'Em revisão', value: (s.tasks?.review ?? 0) + (s.review_waiting ?? 0), hint: `${s.review_waiting ?? 0} entregas esperando você` },
      { label: 'Esperando produção', value: (s.waiting_production ?? []).reduce((n, r) => n + r.commits, 0), hint: `${s.tasks?.dev ?? 0} tarefas em dev · commits fora da main` },
      { label: 'Ideias', value: (s.ideas?.new ?? 0) + (s.ideas?.approved_waiting ?? 0), hint: `${s.ideas?.new ?? 0} novas · ${s.ideas?.approved_waiting ?? 0} aprovadas paradas` },
      { label: 'Execuções (7 dias)', value: (s.runs_7d?.succeeded ?? 0) + (s.runs_7d?.failed ?? 0), hint: `${s.runs_7d?.failed ?? 0} falharam · ${s.runs_7d?.active ?? 0} agora` },
      { label: 'Decisões abertas', value: s.decisions_open ?? 0, hint: `${s.tasks?.done ?? 0} tarefas feitas em 30 dias` },
    ];
  }
}
