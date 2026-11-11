import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MeetingImport } from '../../../../shared/components/meeting-import/meeting-import';
import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { DeliveriesService } from '../../../../shared/services/deliveries/deliveries.service';
import { IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { Proposal, Verdict } from '../../../../shared/services/proposals/proposals.model';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { QuickCommandsService } from '../../../../shared/services/quick-commands/quick-commands.service';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { TasksService } from '../../../../shared/services/tasks/tasks.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { PulseService } from '../../services/pulse/pulse.service';
import { ProductCard } from './components/product-card/product-card';
import { StoryCard } from './components/story-card/story-card';

/**
 * Mesa do diretor: a tela que abre. Só o que é do Gustavo: histórias para usar e validar, o crítico para decidir, os
 * produtos (para onde vão, quem cuida, os números) e uma caixa para pedir, anotar ou trazer uma reunião. O resto da
 * operação mora nos Bastidores e anda com os donos.
 */
@Component({
  selector: 'app-desk-page',
  imports: [AgoPipe, Icon, MeetingImport, ProductCard, ProjectSelect, RouterLink, StoryCard],
  templateUrl: './desk-page.html',
  host: { class: 'block h-full overflow-y-auto' },
})
export class DeskPage {
  protected readonly deliveries = inject(DeliveriesService);
  protected readonly proposals = inject(ProposalsService);
  protected readonly runs = inject(RunsService);
  protected readonly projects = inject(ProjectsService);
  protected readonly pulse = inject(PulseService);
  private readonly tasks = inject(TasksService);
  private readonly ideas = inject(IdeasService);
  private readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);
  private readonly quick = inject(QuickCommandsService);

  protected readonly date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  protected readonly greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; })();

  private readonly byTask = computed(() => new Map(this.tasks.tasks().map(t => [t.id, t])));
  /** histórias prontas para usar: entrega em revisão de uma tarefa que tem partes */
  protected readonly stories = computed(() => this.deliveries.board()
    .filter(d => d.status === 'review' && d.taskId && (this.byTask().get(d.taskId)?.subtasks ?? 0) > 0)
    .map(d => ({ d, task: this.byTask().get(d.taskId!) ?? null })));
  /** o que ainda chega do jeito antigo (tarefa solta para revisar): fica nos Bastidores, aqui só a contagem */
  protected readonly loose = computed(() => {
    const story = new Set(this.stories().map(s => s.d.id));
    const covered = new Set(this.deliveries.board().map(d => d.taskId));
    return this.deliveries.board().filter(d => !story.has(d.id)).length
      + this.tasks.tasks().filter(t => t.column === 'review' && !t.parentId && !covered.has(t.id)).length;
  });
  /** decidir: o que os agentes trouxeram (pelas regras novas, só o crítico), com o rumo proposto primeiro */
  protected readonly decisions = computed(() => [...this.proposals.inbox()].sort((a, b) => Number(b.source === 'rumo') - Number(a.source === 'rumo')));
  /** ideias que o dono achou impactantes demais para decidir sozinho */
  protected readonly escalated = computed(() => this.ideas.fresh().filter(i => /^precisa do operador/i.test(i.triage ?? '')));
  protected readonly otherIdeas = computed(() => this.ideas.fresh().length - this.escalated().length);
  protected readonly blockers = this.runs.waiting;
  protected readonly forYou = computed(() => this.stories().length + this.decisions().length + this.blockers().length + this.escalated().length);
  /** produtos com dono ou trabalho andando, dos que agem sozinhos para os parados */
  protected readonly products = computed(() => (this.pulse.pulse()?.projects ?? [])
    .filter(p => p.owner || p.storiesOpen || p.metrics.length)
    .sort((a, b) => Number(b.ownerOn) - Number(a.ownerOn) || b.toValidate - a.toValidate || b.storiesOpen - a.storiesOpen));
  /** sem dono e sem nada andando: uma linha só, com o atalho para escolher o dono */
  protected readonly ownerless = computed(() => (this.pulse.pulse()?.projects ?? []).filter(p => !p.owner && !p.storiesOpen && !p.metrics.length));
  protected readonly working = computed(() => this.runs.active().length);

  // caixa de pedido
  protected readonly text = signal('');
  protected readonly slug = signal('');
  protected readonly sending = signal<'ask' | 'note' | null>(null);
  protected readonly sent = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /** quem recebe o pedido: o dono do projeto escolhido (ou a Central) */
  protected readonly receiver = computed(() => {
    const p = this.projects.bySlug().get(this.slug());
    return (p?.todoAgentId ? this.agents.byId().get(p.todoAgentId) : null) ?? this.agents.central() ?? null;
  });

  constructor() {
    effect(() => { this.runs.runs().length; this.deliveries.board().length; this.projects.projects(); this.pulse.load(); });
  }

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected decide(p: Proposal, verdict: Verdict, reason: string | null = null): void { this.proposals.decide(p, verdict, reason); }
  protected choose(p: Proposal, option: string): void { this.decide(p, 'approve', `Escolheu: ${option}`); }

  protected async approveIdea(id: number, slug: string | null): Promise<void> {
    try { await this.ideas.approve(id, slug); } catch (e) { this.error.set((e as Error).message); }
  }
  protected discardIdea(id: number): void { this.ideas.setStatus(id, 'archived'); }

  protected runFix(command: string, slug: string | null): void {
    this.quick.inTerminal(command, slug, 'shell', true).catch(e => this.error.set((e as Error).message));
  }
  protected async resume(runId: number): Promise<void> {
    try { const c = await this.runs.resume(runId); if (c) this.chat.openInPanel(c); } catch (e) { this.error.set((e as Error).message); }
  }

  /** pedir: vai para o dono do projeto (ou a Central), que planeja e põe o time para fazer */
  protected async ask(): Promise<void> {
    const text = this.text().trim();
    const agent = this.receiver();
    if (!text || !agent) return;
    this.sending.set('ask'); this.error.set(null);
    try {
      const p = this.project(this.slug());
      const id = await this.chat.startBackground(agent.id, p ? `Projeto ${p.name} (${p.slug}): ${text}` : text);
      this.chat.openInPanel(id);
      this.done(`Pedido com ${agent.name}.`);
    } catch (e) { this.error.set((e as Error).message); } finally { this.sending.set(null); }
  }

  /** anotar: com projeto de dono ligado, já vai aprovada para ele planejar; sem projeto, cai na Triagem */
  protected async note(): Promise<void> {
    const text = this.text().trim();
    if (!text) return;
    this.sending.set('note'); this.error.set(null);
    try {
      const [title, ...rest] = text.split('\n');
      const slug = this.slug() || null;
      const id = await this.ideas.create(title.slice(0, 160), rest.join('\n').trim(), slug);
      const p = this.project(slug);
      if (p?.ownerOn) { await this.ideas.approve(id, slug); this.done(`Anotado: ${p.name} vai planejar.`); }
      else this.done(slug ? 'Anotado na Triagem do projeto.' : 'Anotado na Triagem.');
    } catch (e) { this.error.set((e as Error).message); } finally { this.sending.set(null); }
  }

  private done(msg: string): void {
    this.text.set('');
    this.sent.set(msg);
    setTimeout(() => this.sent.set(null), 4000);
  }
}
