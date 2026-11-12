import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AgentSelect } from '../../../../shared/components/pickers/agent-select';
import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { DirectionService } from '../../../../shared/services/direction/direction.service';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { AskService } from '../../../../shared/services/ask/ask.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { LiveService } from '../../../../shared/services/live/live.service';
import { IDEA_SOURCE_LABEL, Idea, IdeasService } from '../../../../shared/services/ideas/ideas.service';
import { IpcService, errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ScopeService, markProjects } from '../../../../shared/services/scope/scope.service';
import { WaitingRuns, needsYou } from './components/waiting-runs/waiting-runs';
import { MeetingImport } from '../../../../shared/components/meeting-import/meeting-import';
import { Proposal, RISK_LABEL, SOURCE_LABEL, Verdict } from '../../../../shared/services/proposals/proposals.model';
import { ProposalsService } from '../../../../shared/services/proposals/proposals.service';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { SettingsApiService } from '../../../../shared/services/settings/settings-api.service';
import { TriageFocusService, TriageTab, blocking } from '../../../../shared/services/triage-focus/triage-focus.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { MarkdownPipe } from '../../../../shared/ui/markdown';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';

const KEYS: Record<string, Verdict> = { a: 'approve', d: 'defer', n: 'reject' };

/** O pedido ao gestor quando você aprova e manda planejar: só esta ideia, nada de reorganizar o backlog inteiro. */
export const planRequest = (id: number, title: string) =>
  `Acabei de aprovar a ideia #${id} ("${title}"). Quebre só ela: tarefas no backlog ligadas a ela (create_task com idea_id; coluna todo quando estiver clara e pequena, backlog quando precisar de mais definição) e decisões (create_decision) para o que depender de mim. Ligue ao marco do roadmap que ela serve, se houver. Não mexa no resto do backlog.`;
/** conversas abertas a partir da triagem começam assim */
const PREFIX = 'Triagem: ';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Item da triagem: decisão (pergunta/alerta de um agente ou do CI) ou ideia nova (sua ou de um agente). */
type Item = { kind: 'decision'; p: Proposal } | { kind: 'idea'; i: Idea };
const keyOf = (q: Item) => (q.kind === 'decision' ? `d${q.p.id}` : `i${q.i.id}`);
const slugOf = (q: Item) => (q.kind === 'decision' ? q.p.projectSlug : q.i.projectSlug);
const dateOf = (q: Item) => (q.kind === 'decision' ? q.p.createdAt : q.i.createdAt).getTime();
const stuck = (q: Item) => q.kind === 'decision' && blocking(q.p);

type TriageMode = 'off' | 'no_project' | 'all';
const MODES: { id: TriageMode; label: string; hint: string }[] = [
  { id: 'no_project', label: 'Só ideias sem projeto', hint: 'Descobre o projeto e organiza o que você jogou solto.' },
  { id: 'all', label: 'Todas as minhas ideias', hint: 'Lê tudo que você anota, com ou sem projeto.' },
  { id: 'off', label: 'Desligado', hint: 'As ideias chegam como você escreveu.' },
];

/** Recomendação do agente de triagem → botão que fica em destaque. */
export function suggestion(triage: string | null): 'plan' | 'approve' | 'reject' | 'steer' | null {
  const t = (triage ?? '').trim().toLowerCase();
  if (t.startsWith('aprovar e planejar')) return 'plan';
  if (t.startsWith('aprovar')) return 'approve';
  if (t.startsWith('descartar')) return 'reject';
  if (t.startsWith('precisa')) return 'steer';
  return null;
}

/** Uma linha a partir de um texto em markdown (para decisões antigas, sem resumo do agente). */
export function oneLine(md: string | null): string {
  const line = (md ?? '').split('\n').map(l => l.replace(/^\s*(#+|[-*>]|\d+\.)\s*/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim()).find(Boolean) ?? '';
  const end = line.search(/[.!?](\s|$)/);
  const s = end > 20 ? line.slice(0, end + 1) : line;
  return s.length > 160 ? `${s.slice(0, 157).replace(/\s+\S*$/, '')}…` : s;
}

/**
 * Triagem: decisões e ideias em abas, agrupadas por projeto numa grade de cards. O que trava um agente vem primeiro
 * (com o tempo parado). Clicar abre o item num modal com o contexto e as ações; dá para selecionar vários e decidir em lote.
 */
@Component({
  selector: 'app-inbox-page',
  imports: [Icon, RouterLink, ProjectSelect, AgentSelect, ProjectAvatar, AgoPipe, MarkdownPipe, WaitingRuns, MeetingImport],
  templateUrl: './inbox-page.html',
  host: { class: 'block h-full overflow-y-auto', '(document:keydown)': 'onKey($event)' },
})
export class InboxPage {
  protected readonly proposals = inject(ProposalsService);
  protected readonly ideas = inject(IdeasService);
  protected readonly focus = inject(TriageFocusService);
  protected readonly projects = inject(ProjectsService);
  private readonly direction = inject(DirectionService);
  private readonly chat = inject(ChatService);
  private readonly agents = inject(AgentsService);
  protected readonly live = inject(LiveService);
  private readonly settings = inject(SettingsApiService);
  private readonly ask = inject(AskService);

  protected readonly key = keyOf;
  protected readonly stuck = stuck;
  protected readonly oneLine = oneLine;
  protected readonly risk = RISK_LABEL;
  protected readonly source = (s: string) => SOURCE_LABEL[s] ?? IDEA_SOURCE_LABEL[s] ?? s;

  /** ideias deixadas para depois nesta visita (continuam novas, vão para o fim do grupo) */
  private readonly skipped = signal<ReadonlySet<number>>(new Set());

  // ---------- abas, filtros e grade ----------
  protected readonly scope = inject(ScopeService);
  private readonly runsSvc = inject(RunsService);
  /** execuções paradas por sua causa (aba Esperando você) */
  protected readonly waitingCount = computed(() => { const all = this.runsSvc.runs(); return all.filter(r => needsYou(r, all) && this.scope.matches(r.projectSlug)).length; });
  private readonly marks = markProjects(() => this.focus.tab() === 'decision'
    ? this.proposals.inbox().filter(p => this.focus.decision(p)).map(p => p.projectSlug)
    : this.focus.tab() === 'waiting' ? this.runsWaiting().map(r => r.projectSlug)
    : this.ideas.unseen().filter(i => this.focus.idea(i)).map(i => i.projectSlug), 'bg-later text-night', 'para triar');
  private readonly runsWaiting = computed(() => { const all = this.runsSvc.runs(); return all.filter(r => needsYou(r, all)); });
  protected readonly decisionCount = computed(() => this.proposals.inbox().filter(p => this.focus.decision(p) && this.scope.matches(p.projectSlug)).length);
  /** novidades (o resto você já viu) */
  protected readonly newIdeas = computed(() => this.ideas.unseen().filter(i => this.focus.idea(i) && this.scope.matches(i.projectSlug)).length);
  protected markAllSeen(): void { this.ideas.markSeen(this.ideas.fresh().filter(i => this.scope.matches(i.projectSlug)).map(i => i.id)); }
  protected readonly ideaCount = computed(() => this.ideas.fresh().filter(i => this.focus.idea(i) && this.scope.matches(i.projectSlug)).length);
  protected readonly stuckCount = computed(() => this.proposals.inbox().filter(p => blocking(p) && this.focus.decision(p, { ...this.focus.focus(), blocking: false })).length);
  protected readonly total = computed(() => this.decisionCount() + this.ideaCount());

  protected readonly items = computed<Item[]>(() => this.focus.tab() === 'decision'
    ? this.proposals.inbox().filter(p => this.focus.decision(p) && this.scope.matches(p.projectSlug)).map(p => ({ kind: 'decision' as const, p }))
    : this.ideas.fresh().filter(i => this.focus.idea(i) && this.scope.matches(i.projectSlug)).map(i => ({ kind: 'idea' as const, i })));

  /**
   * por projeto. Decisões: o que trava primeiro (o mais antigo antes), depois o mais novo. Ideias: só pela data de criação,
   * a mais nova primeiro (e o projeto da ideia mais nova no topo).
   */
  protected readonly groups = computed(() => {
    const ideas = this.focus.tab() !== 'decision';
    const rank = (q: Item) => (stuck(q) ? 0 : 1);
    const m = new Map<string, Item[]>();
    for (const q of this.items()) { const k = this.focus.top(slugOf(q)); m.set(k, [...(m.get(k) ?? []), q]); }
    const groups = [...m].map(([slug, list]) => ({
      slug, project: this.project(slug), stuck: list.filter(stuck).length,
      list: list.sort((a, b) => rank(a) - rank(b) || (stuck(a) ? dateOf(a) - dateOf(b) : dateOf(b) - dateOf(a))),
    }));
    return ideas
      ? groups.sort((a, b) => dateOf(b.list[0]) - dateOf(a.list[0]))
      : groups.sort((a, b) => b.stuck - a.stuck || (a.slug ? 0 : 1) - (b.slug ? 0 : 1) || (a.project?.name ?? '').localeCompare(b.project?.name ?? ''));
  });
  protected readonly flat = computed(() => this.groups().flatMap(g => g.list));

  /** toggles de projeto: os que têm algo nesta aba (e os já ligados) */
  protected readonly chips = computed(() => {
    const f = { ...this.focus.focus(), projects: [] };
    const slugs = this.focus.tab() === 'decision'
      ? this.proposals.inbox().filter(p => this.focus.decision(p, f)).map(p => p.projectSlug)
      : this.ideas.fresh().map(i => i.projectSlug);
    const n = new Map<string, number>();
    for (const s of slugs) { const k = this.focus.top(s); n.set(k, (n.get(k) ?? 0) + 1); }
    for (const k of this.focus.focus().projects) if (!n.has(k)) n.set(k, 0);
    return [...n].map(([id, count]) => ({ id, count, project: this.project(id), on: this.focus.focus().projects.includes(id) }))
      .sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || (a.project?.name ?? '').localeCompare(b.project?.name ?? ''));
  });

  protected setTab(t: TriageTab): void { this.focus.setTab(t); this.selected.set(new Set()); this.error.set(null); }

  // ---------- seleção e lote ----------
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected toggleSel(q: Item): void {
    const s = new Set(this.selected()), k = keyOf(q);
    if (!s.delete(k)) s.add(k);
    this.selected.set(s);
  }
  protected selectGroup(list: Item[]): void {
    const keys = list.map(keyOf), all = keys.every(k => this.selected().has(k));
    const s = new Set(this.selected());
    for (const k of keys) { if (all) s.delete(k); else s.add(k); }
    this.selected.set(s);
  }
  protected clearSel(): void { this.selected.set(new Set()); }

  /** excluir de vez (recusar deixa no histórico; isto apaga) */
  protected async removeCurrent(): Promise<void> {
    const item = this.current();
    if (item?.kind !== 'decision') return;
    if (!(await this.ask.confirm('Excluir esta decisão?', { message: `"${item.p.title}" some da Triagem e do histórico.`, confirmLabel: 'Excluir', danger: true }))) return;
    const l = this.flat(), at = this.position();
    const next = l[at + 1] ?? l[at - 1];
    this.proposals.remove(item.p);
    if (next && next !== item) this.open(next); else this.close();
  }
  protected async removeSelected(): Promise<void> {
    const sel = this.flat().filter(q => q.kind === 'decision' && this.selected().has(keyOf(q))) as { kind: 'decision'; p: Proposal }[];
    if (!sel.length) return;
    if (!(await this.ask.confirm(`Excluir ${sel.length} ${sel.length === 1 ? 'decisão' : 'decisões'}?`, { message: 'Somem da Triagem e do histórico.', confirmLabel: 'Excluir', danger: true }))) return;
    for (const q of sel) this.proposals.remove(q.p);
    this.clearSel();
  }
  protected allIn(list: Item[]): boolean { return list.every(q => this.selected().has(keyOf(q))); }

  /** aprovar em lote pula o que precisa de você: ideia sem projeto e decisão com opções (falta escolher uma) */
  protected async batch(verdict: Verdict): Promise<void> {
    const sel = this.flat().filter(q => this.selected().has(keyOf(q)));
    const kept = new Set<string>();
    this.error.set(null);
    try {
      for (const q of sel) {
        if (verdict === 'approve' && (q.kind === 'idea' ? !q.i.projectSlug : q.p.options.length > 0)) { kept.add(keyOf(q)); continue; }
        if (q.kind === 'decision') this.proposals.decide(q.p, verdict);
        else if (verdict === 'approve') await this.ideas.approve(q.i.id, null);
        else if (verdict === 'reject') await this.ideas.setStatus(q.i.id, 'archived');
        else { this.skipped.update(s => new Set([...s, q.i.id])); this.ideas.markSeen([q.i.id]); }
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    }
    this.selected.set(verdict === 'defer' ? new Set() : kept);
    if (kept.size) this.error.set(`${kept.size} ${kept.size === 1 ? 'ficou selecionada' : 'ficaram selecionadas'}: ${this.focus.tab() === 'idea' ? 'falta escolher o projeto' : 'falta escolher uma das opções'}. Abra para decidir.`);
  }

  // ---------- modal ----------
  private readonly openKey = signal<string | null>(null);
  protected readonly current = computed(() => this.flat().find(q => keyOf(q) === this.openKey()) ?? null);
  protected readonly position = computed(() => this.flat().findIndex(q => keyOf(q) === this.openKey()));
  protected readonly suggested = computed(() => { const c = this.current(); return c?.kind === 'idea' ? suggestion(c.i.triage) : null; });
  protected readonly leaving = signal<Verdict | null>(null);
  /** projeto escolhido no modal da ideia (se ela ainda não tem) */
  protected readonly pickSlug = signal('');
  protected readonly error = signal<string | null>(null);
  /** ideias aprovadas e mandadas para o gestor planejar nesta tela (aviso discreto) */
  protected readonly sentToPlan = signal<string[]>([]);

  protected open(q: Item | undefined): void {
    if (!q) return;
    if (q.kind === 'idea') this.ideas.markSeen([q.i.id]);
    this.openKey.set(keyOf(q));
    this.steering.set(false);
    this.pickSlug.set('');
    this.error.set(null);
    queueMicrotask(() => document.querySelector<HTMLElement>('#tri-modal')?.focus());
  }
  protected close(): void { this.openKey.set(null); this.steering.set(false); }
  protected move(d: number): void { this.open(this.flat()[this.position() + d]); }

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected approveAndPlan(): void { this.decide('approve', true); }
  protected choose(option: string): void { this.decide('approve', false, `Escolheu: ${option}`); }

  protected decide(verdict: Verdict, plan = false, reason: string | null = null): void {
    const item = this.current();
    if (!item || this.leaving()) return;
    if (item.kind === 'idea' && verdict === 'approve' && !(item.i.projectSlug || this.pickSlug())) {
      this.error.set('Escolha o projeto da ideia antes de aprovar.');
      return;
    }
    if (item.kind === 'decision' && verdict === 'approve' && !reason && item.p.options.length) {
      this.error.set('Escolha uma das opções (ou Direcionar para outra resposta).');
      return;
    }
    // depois de decidir, abre o próximo (ou o anterior, se era o último)
    const l = this.flat(), at = this.position();
    const next = l[at + 1] ?? l[at - 1];
    this.error.set(null);
    this.leaving.set(verdict);
    setTimeout(async () => {
      try {
        if (item.kind === 'decision') this.proposals.decide(item.p, verdict, reason);
        else if (verdict === 'approve') {
          const slug = item.i.projectSlug ?? this.pickSlug();
          await this.ideas.approve(item.i.id, item.i.projectSlug ? null : slug);
          if (plan) {
            await this.direction.plan(slug, planRequest(item.i.id, item.i.title));
            this.sentToPlan.update(s => [item.i.title, ...s].slice(0, 5));
          }
        }
        else if (verdict === 'reject') this.ideas.setStatus(item.i.id, 'archived');
        else this.skipped.update(s => new Set([...s, item.i.id]));
        const s = new Set(this.selected()); s.delete(keyOf(item)); this.selected.set(s);
        if (next && next !== item) this.open(next); else this.close();
      } catch (e) {
        this.error.set(errorMessage(e));
      }
      this.leaving.set(null);
    }, reducedMotion() ? 120 : 220);
  }

  protected onKey(e: KeyboardEvent): void {
    if (!this.current()) return;
    if (e.key === 'Escape') { if (this.steering()) this.steering.set(false); else this.close(); return; }
    const tag = (e.target as HTMLElement).tagName;
    if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowright' || k === 'j') { e.preventDefault(); this.move(1); return; }
    if (k === 'arrowleft' || k === 'k') { e.preventDefault(); this.move(-1); return; }
    if (k === 'r') { e.preventDefault(); this.openSteer(); return; }
    const item = this.current()!;
    if (k === 'p' && item.kind === 'idea') { e.preventDefault(); this.approveAndPlan(); return; }
    const n = Number(k);
    if (item.kind === 'decision' && n >= 1 && n <= item.p.options.length) { e.preventDefault(); this.choose(item.p.options[n - 1]); return; }
    const verdict = KEYS[k];
    if (verdict) { e.preventDefault(); this.decide(verdict); }
  }

  // ---------- agente de triagem: quando roda e quem faz ----------
  protected readonly modes = MODES;
  protected readonly triageMode = signal<TriageMode>('no_project');
  protected readonly triageAgent = signal('');
  protected readonly modeLabel = computed(() => ({ off: 'desligado', no_project: 'sem projeto', all: 'todas' })[this.triageMode()]);
  /** alguma ideia foi pega há pouco e ainda não tem recomendação */
  protected readonly triageRunning = computed(() => this.ideas.fresh().some(i => this.reading(i)));
  protected reading(i: Idea): boolean {
    return !!i.triagedAt && !i.triage && this.triageMode() !== 'off' && Date.now() - i.triagedAt.getTime() < 30 * 60_000;
  }

  constructor() {
    this.settings.get('triage:mode').then(v => { if (v === 'off' || v === 'all' || v === 'no_project') this.triageMode.set(v); });
    this.settings.get('triage:agent').then(v => this.triageAgent.set(v ?? ''));
  }

  protected setMode(m: TriageMode): void { this.triageMode.set(m); this.settings.set('triage:mode', m); }
  protected setAgent(id: string): void { this.triageAgent.set(id); this.settings.set('triage:agent', id); }

  // ---------- direcionar: o texto vai para a Central junto com o item ----------
  protected readonly steering = signal(false);
  protected readonly guidance = signal('');
  protected readonly sending = signal(false);
  /** conversas da triagem (últimos 3 dias): o que está com a Central agora */
  protected readonly discussing = computed(() => {
    const since = Date.now() - 3 * 86_400_000;
    return this.chat.chats().filter(c => c.title.startsWith(PREFIX) && c.updatedAt.getTime() > since).slice(0, 6)
      .map(c => ({ id: c.id, title: c.title.slice(PREFIX.length), at: c.updatedAt, live: this.live.chat(c.id) }));
  });

  /** quem recebe o direcionamento ('' = a Central): o agente que pediu a decisão (ou o último que trabalhou na tarefa dela) */
  protected readonly steerTo = signal('');
  private readonly runsService = inject(RunsService);
  private readonly ipc = inject(IpcService);
  private askedBy(p: Proposal): number | null {
    if (p.agentId && this.agents.byId().has(p.agentId)) return p.agentId;
    if (!p.taskId) return null;
    const r = this.runsService.runs().filter(x => x.taskId === p.taskId && x.agentId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return r?.agentId ?? null;
  }
  protected steerName(): string {
    const a = this.steerTo() ? this.agents.byId().get(Number(this.steerTo())) : null;
    return a && !a.builtin ? a.name : 'a Central';
  }

  protected openSteer(): void {
    const item = this.current();
    const by = item?.kind === 'decision' ? this.askedBy(item.p) : null;
    this.steerTo.set(by && by !== this.agents.central()?.id ? String(by) : '');
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
    const target = this.steerTo() ? this.agents.byId().get(Number(this.steerTo())) ?? central : central;
    if (!item || !text || !target) return;
    const l = this.flat(), next = l[this.position() + 1] ?? l[this.position() - 1];
    this.sending.set(true);
    this.error.set(null);
    try {
      // decisão de volta para quem pediu: na mesma sessão dela, quando existe; senão, conversa nova com o contexto todo
      const same = item.kind === 'decision' ? await this.ipc.invoke('proposals:steer', item.p.id, target.id, sessionPrompt(item.p, text)) : null;
      if (same) this.chat.loadChats();
      else await this.chat.startBackground(target.id, item.kind === 'idea' ? ideaPrompt(item.i, this.project(item.i.projectSlug)?.name ?? null, text)
        : decisionPrompt(item.p, this.project(item.p.projectSlug)?.name ?? null, text));
      // sai da fila desta visita; volta com o que a Central mudar (ou some, se ela aprovou/descartou)
      if (item.kind === 'idea') this.skipped.update(s => new Set([...s, item.i.id]));
      else this.proposals.decide(item.p, 'defer');
      this.guidance.set('');
      this.steering.set(false);
      if (next && next !== item) this.open(next); else this.close();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.sending.set(false);
    }
  }

  protected openChat(id: number): void { this.chat.openInPanel(id); }
}

const ideaPrompt = (i: Idea, project: string | null, guidance: string) => `${PREFIX}${i.title}

O Gustavo está fazendo a triagem e, em vez de aprovar ou descartar esta ideia, deu um direcionamento. Faça o que ele pediu com as ferramentas da Central.

Ideia #${i.id} (status: nova; projeto: ${project ?? 'nenhum'}; ${i.author === 'gustavo' ? 'anotada por ele' : 'sugerida por um agente'})
Título: ${i.title}
${i.body ? `Descrição: ${i.body}` : ''}

Direcionamento dele:
"${guidance}"

Você pode: reescrever, dividir ou juntar ideias (update_idea, create_idea), mudar o projeto, aprovar (update_idea status approved) ou descartar (archived) se foi isso que ele disse, criar tarefas ligadas à ideia (create_task com idea_id) se ele pediu execução, consultar o rumo, o backlog e o código antes de decidir. Se algo ficar ambíguo, não adivinhe: pergunte aqui. Termine dizendo em 2 ou 3 linhas o que fez.`;

const sessionPrompt = (p: Proposal, guidance: string) => `O Gustavo respondeu na Triagem à decisão #${p.id} que você pediu ("${p.title}"): em vez de aprovar ou recusar, deu um direcionamento.

"${guidance}"

Siga o que ele pediu. Se for para decidir, registre com decide na #${p.id} (com o motivo); se mudar o plano, ajuste e continue. Se algo ficar ambíguo, pergunte aqui. Termine dizendo em 2 ou 3 linhas o que fez.`;

const decisionPrompt = (p: Proposal, project: string | null, guidance: string) => `${PREFIX}${p.title}

O Gustavo está fazendo a triagem e, em vez de aprovar ou recusar esta decisão, deu um direcionamento. Faça o que ele pediu com as ferramentas da Central.

Decisão #${p.id} (projeto: ${project ?? 'nenhum'})
Título: ${p.title}
${p.body ? `Contexto: ${p.body}` : ''}
${p.options.length ? `Opções que o agente deu: ${p.options.join(' | ')}` : ''}
${p.nextAction ? `Se aprovada, o próximo passo seria: ${p.nextAction}` : ''}

Direcionamento dele:
"${guidance}"

Você pode: registrar a decisão como ele indicou (decide, com o motivo), criar tarefas ou ideias com o ajuste que ele pediu, consultar o rumo, o backlog e o código, ou pôr um agente para trabalhar se ele pediu (start_agent). Se algo ficar ambíguo, pergunte aqui. Termine dizendo em 2 ou 3 linhas o que fez.`;
