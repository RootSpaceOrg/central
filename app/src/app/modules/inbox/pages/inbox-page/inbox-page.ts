import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { DirectionService } from '../../../../shared/services/direction/direction.service';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { LiveService } from '../../../../shared/services/live/live.service';
import { IDEA_SOURCE_LABEL, Idea, IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { Proposal, RISK_LABEL, SOURCE_LABEL, Verdict } from '../../../../shared/services/proposals/proposals.model';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';

const KEYS: Record<string, Verdict> = { a: 'approve', d: 'defer', n: 'reject' };
/** conversas abertas a partir da triagem começam assim (a lateral lista as recentes) */
const PREFIX = 'Triagem: ';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Item da triagem: decisão (pergunta/alerta de um agente ou do CI) ou ideia nova (sua ou de um agente). */
type Item = { kind: 'decision'; p: Proposal } | { kind: 'idea'; i: Idea };

/**
 * Triagem: o trabalho de gestor num lugar só. Uma coisa de cada vez: decisões primeiro (alguém está esperando),
 * depois ideias novas. Aprovar uma ideia a torna insumo do backlog do projeto; o gestor do projeto quebra em tarefas.
 */
@Component({
  selector: 'app-inbox-page',
  imports: [Icon, RouterLink, ProjectSelect, ProjectAvatar, AgoPipe],
  templateUrl: './inbox-page.html',
  host: { class: 'block h-full overflow-y-auto', '(document:keydown)': 'onKey($event)' },
})
export class InboxPage {
  protected readonly proposals = inject(ProposalsService);
  protected readonly ideas = inject(IdeasService);
  protected readonly projects = inject(ProjectsService);
  protected readonly direction = inject(DirectionService);
  private readonly chat = inject(ChatService);
  private readonly agents = inject(AgentsService);
  protected readonly live = inject(LiveService);

  /** ideias deixadas para depois nesta visita (continuam novas, vão para o fim) */
  private readonly skipped = signal<ReadonlySet<number>>(new Set());
  protected readonly queue = computed<Item[]>(() => {
    const ideas = this.ideas.fresh();
    const later = this.skipped();
    return [
      ...this.proposals.inbox().map(p => ({ kind: 'decision' as const, p })),
      ...ideas.filter(i => !later.has(i.id)).map(i => ({ kind: 'idea' as const, i })),
      ...ideas.filter(i => later.has(i.id)).map(i => ({ kind: 'idea' as const, i })),
    ];
  });
  protected readonly current = computed(() => this.queue()[0] ?? null);
  protected readonly behind = computed(() => Math.min(this.queue().length - 1, 2));
  protected readonly leaving = signal<Verdict | null>(null);
  /** projeto escolhido no cartão da ideia (se ela ainda não tem) */
  protected readonly pickSlug = signal('');
  protected readonly error = signal<string | null>(null);

  /** aprovadas que ainda não viraram tarefa, por projeto: o gestor de cada um tem trabalho */
  protected readonly waiting = computed(() => {
    const m = new Map<string, Idea[]>();
    for (const i of this.ideas.waiting()) if (i.projectSlug) m.set(i.projectSlug, [...(m.get(i.projectSlug) ?? []), i]);
    return [...m].map(([slug, list]) => ({ slug, list }));
  });

  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly projectSlug = signal('');
  protected readonly risk = RISK_LABEL;
  protected readonly source = (s: string) => SOURCE_LABEL[s] ?? IDEA_SOURCE_LABEL[s] ?? s;
  protected readonly planned = signal<Record<string, number>>({});

  /** direcionamento livre: o texto vai para a Central junto com o item */
  protected readonly steering = signal(false);
  protected readonly guidance = signal('');
  protected readonly sending = signal(false);
  /** conversas da triagem (últimos 3 dias): o que está com a Central agora */
  protected readonly discussing = computed(() => {
    const since = Date.now() - 3 * 86_400_000;
    return this.chat.chats().filter(c => c.title.startsWith(PREFIX) && c.updatedAt.getTime() > since).slice(0, 8)
      .map(c => ({ id: c.id, title: c.title.slice(PREFIX.length), at: c.updatedAt, live: this.live.chat(c.id) }));
  });

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected decide(verdict: Verdict): void {
    const item = this.current();
    if (!item || this.leaving()) return;
    if (item.kind === 'idea' && verdict === 'approve' && !(item.i.projectSlug || this.pickSlug())) {
      this.error.set('Escolha o projeto da ideia antes de aprovar.');
      return;
    }
    this.error.set(null);
    this.leaving.set(verdict);
    setTimeout(async () => {
      try {
        if (item.kind === 'decision') this.proposals.decide(item.p, verdict);
        else if (verdict === 'approve') await this.ideas.approve(item.i.id, item.i.projectSlug ? null : this.pickSlug());
        else if (verdict === 'reject') this.ideas.setStatus(item.i.id, 'archived');
        else this.skipped.update(s => new Set([...s, item.i.id]));
      } catch (e) {
        this.error.set(errorMessage(e));
      }
      this.pickSlug.set('');
      this.leaving.set(null);
    }, reducedMotion() ? 120 : 220);
  }

  protected onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.querySelector('dialog[open]')) return;
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); this.openSteer(); return; }
    const verdict = KEYS[e.key.toLowerCase()];
    if (verdict) this.decide(verdict);
  }

  protected openSteer(): void {
    this.steering.set(true);
    queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('#tri-guidance')?.focus());
  }

  /**
   * "Direcionar": nem aprovar nem descartar, e sim dizer o que fazer. A Central recebe o item inteiro + o texto e age
   * pelas ferramentas dela (reescreve, divide, junta, aprova/descarta se foi isso, cria tarefas, pesquisa, ou pergunta).
   */
  protected async steer(): Promise<void> {
    const item = this.current();
    const text = this.guidance().trim();
    const central = this.agents.central();
    if (!item || !text || !central) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      await this.chat.startBackground(central.id, item.kind === 'idea' ? ideaPrompt(item.i, this.project(item.i.projectSlug)?.name ?? null, text)
        : decisionPrompt(item.p, this.project(item.p.projectSlug)?.name ?? null, text));
      // sai da fila desta visita; volta com o que a Central mudar (ou some, se ela aprovou/descartou)
      if (item.kind === 'idea') this.skipped.update(s => new Set([...s, item.i.id]));
      else this.proposals.decide(item.p, 'defer');
      this.guidance.set('');
      this.steering.set(false);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.sending.set(false);
    }
  }

  protected openChat(id: number): void { this.chat.openInPanel(id); }

  protected async plan(slug: string): Promise<void> {
    try {
      const id = await this.direction.plan(slug);
      this.planned.update(m => ({ ...m, [slug]: id }));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected async capture(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.title().trim()) return;
    try {
      await this.ideas.create(this.title().trim(), this.body().trim(), this.projectSlug() || null);
      this.title.set('');
      this.body.set('');
      this.error.set(null);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}

const ideaPrompt = (i: Idea, project: string | null, guidance: string) => `${PREFIX}${i.title}

O Gustavo está fazendo a triagem e, em vez de aprovar ou descartar esta ideia, deu um direcionamento. Faça o que ele pediu com as ferramentas da Central.

Ideia #${i.id} (status: nova; projeto: ${project ?? 'nenhum'}; ${i.author === 'gustavo' ? 'anotada por ele' : 'sugerida por um agente'})
Título: ${i.title}
${i.body ? `Descrição: ${i.body}` : ''}

Direcionamento dele:
"${guidance}"

Você pode: reescrever, dividir ou juntar ideias (update_idea, create_idea), mudar o projeto, aprovar (update_idea status approved) ou descartar (archived) se foi isso que ele disse, criar tarefas ligadas à ideia (create_task com idea_id) se ele pediu execução, consultar o rumo, o backlog e o código antes de decidir. Se algo ficar ambíguo, não adivinhe: pergunte aqui. Termine dizendo em 2 ou 3 linhas o que fez.`;

const decisionPrompt = (p: Proposal, project: string | null, guidance: string) => `${PREFIX}${p.title}

O Gustavo está fazendo a triagem e, em vez de aprovar ou recusar esta decisão, deu um direcionamento. Faça o que ele pediu com as ferramentas da Central.

Decisão #${p.id} (projeto: ${project ?? 'nenhum'})
Título: ${p.title}
${p.body ? `Contexto: ${p.body}` : ''}
${p.nextAction ? `Se aprovada, o próximo passo seria: ${p.nextAction}` : ''}

Direcionamento dele:
"${guidance}"

Você pode: registrar a decisão como ele indicou (decide, com o motivo), criar tarefas ou ideias com o ajuste que ele pediu, consultar o rumo, o backlog e o código, ou pôr um agente para trabalhar se ele pediu (start_agent). Se algo ficar ambíguo, pergunte aqui. Termine dizendo em 2 ou 3 linhas o que fez.`;
