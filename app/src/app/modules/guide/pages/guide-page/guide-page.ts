import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { ChatView } from '../../../../shared/components/chat-view/chat-view';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { ScopeService } from '../../../../shared/services/scope/scope.service';
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
const KIND: Record<string, string> = { rumo: 'Rumo e roadmap', direcao: 'Direção', prioridade: 'Priorizar e cortar' };
const ITEM_KIND: Record<string, string> = { rumo: 'rumo', marco: 'marco', tarefa: 'tarefa', ideia: 'ideia', cortar: 'cortar', agente: 'agente' };
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
  protected readonly scope = inject(ScopeService);
  protected readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly runs = inject(RunsService);
  private readonly chat = inject(ChatService);

  protected readonly steps = STEPS;
  protected readonly kindLabel = KIND;
  protected readonly itemKind = ITEM_KIND;
  protected readonly whens = WHEN;
  protected readonly starting = signal(false);
  protected readonly question = signal('');
  protected readonly asking = signal(false);

  /** o que está escolhido na barra lateral */
  protected readonly slug = computed(() => this.scope.slug());
  protected readonly project = computed(() => this.scope.project());
  protected readonly guide = computed(() => (this.slug() ? this.guides.openFor(this.slug()!, this.scope.direct()) : null));
  protected readonly history = computed(() => this.guides.guides().filter(g => g.status === 'done' && (!this.slug() || this.scope.matches(g.projectSlug))));
  /** sem projeto escolhido: projetos vivos de cima, com a sessão aberta (se houver) */
  protected readonly choices = computed(() => this.projects.living().filter(p => !p.parentSlug).map(p => ({ p, open: this.guides.open().find(g => g.projectSlug === p.slug) ?? null })));

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
  protected projectOf(slug: string) { return this.projects.bySlug().get(slug) ?? null; }
  protected nameOf(g: Guide): string { const p = this.projectOf(g.projectSlug); return `${p?.name ?? g.projectSlug}${g.direct ? ' (sem frente)' : ''}`; }

  protected async start(): Promise<void> {
    const s = this.slug();
    if (!s) return;
    this.starting.set(true);
    await this.guides.start(s, this.scope.direct());
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

  protected abandon(g: Guide): void { if (confirm('Descartar esta sessão de guia? A conversa fica no histórico do agente.')) this.guides.abandon(g.id); }

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
