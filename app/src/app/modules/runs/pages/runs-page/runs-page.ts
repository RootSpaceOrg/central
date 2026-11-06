import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RUN_STATUS_LABEL, Run, RunStatus, isActive } from '../../../../shared/services/runs/runs.model';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { AgentSelect } from '../../../../shared/components/pickers/agent-select';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { MdLitePipe } from '../../../../shared/ui/md-lite.pipe';

const DOT: Record<RunStatus, string> = {
  queued: 'bg-faint', preparing: 'bg-later', running: 'bg-yes', succeeded: 'bg-yes', failed: 'bg-no', killed: 'bg-faint',
};

@Component({
  selector: 'app-runs-page',
  imports: [RouterLink, Icon, AgoPipe, MdLitePipe, ProjectAvatar, AgentSelect],
  templateUrl: './runs-page.html',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class RunsPage {
  protected readonly runs = inject(RunsService);
  protected readonly projects = inject(ProjectsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);
  protected readonly chatError = signal<string | null>(null);
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');

  protected readonly statusLabel = RUN_STATUS_LABEL;
  protected readonly dot = DOT;
  protected readonly isActive = isActive;

  /** ?projeto= e ?agente= (links de outras telas chegam assim); a situação fica na tela */
  protected readonly filter = computed(() => this.query()?.get('projeto') ?? null);
  protected readonly agentFilter = computed(() => Number(this.query()?.get('agente')) || null);
  protected readonly status = signal<'all' | 'active' | 'attention' | 'done'>('all');

  /** projeto-pai da execução ('-' = sem projeto): as frentes contam como o projeto */
  private groupOf(r: Run): string { return r.projectSlug ? this.projects.bySlug().get(r.projectSlug)?.parentSlug ?? r.projectSlug : '-'; }
  /** precisa de você: esperando (login, acesso), pausada, ou falhou/foi interrompida e ninguém assumiu */
  protected attention(r: Run): boolean { return !!r.waiting || !!r.paused || ((r.status === 'failed' || r.status === 'killed') && !this.handedOff(r)); }

  private readonly byProject = computed(() => {
    const f = this.filter();
    return f ? this.runs.runs().filter(r => r.projectSlug === f || this.groupOf(r) === f) : this.runs.runs();
  });
  protected readonly projectChips = computed(() => {
    const n = new Map<string, { n: number; live: number }>();
    for (const r of this.runs.runs()) {
      const k = this.groupOf(r), c = n.get(k) ?? { n: 0, live: 0 };
      c.n++; if (isActive(r.status)) c.live++;
      n.set(k, c);
    }
    const order = this.projects.living().map(p => p.slug);
    const slugs = [...n.keys()].filter(k => k !== '-').sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return [...slugs.map(s => ({ id: s, project: this.project(s), ...n.get(s)! })), ...(n.has('-') ? [{ id: '-', project: null, ...n.get('-')! }] : [])];
  });
  protected readonly agentTabs = computed(() => {
    const n = new Map<number, { n: number; live: number }>();
    for (const r of this.byProject()) {
      if (!r.agentId) continue;
      const c = n.get(r.agentId) ?? { n: 0, live: 0 };
      c.n++; if (isActive(r.status)) c.live++;
      n.set(r.agentId, c);
    }
    return [...n].map(([id, c]) => ({ agent: this.agent(id), id, ...c })).filter(x => x.agent).sort((a, b) => b.live - a.live || b.n - a.n);
  });
  private readonly byAgent = computed(() => { const a = this.agentFilter(); return a ? this.byProject().filter(r => r.agentId === a) : this.byProject(); });
  protected readonly statusChips = computed(() => {
    const l = this.byAgent();
    return [
      { id: 'all' as const, label: 'Todas', n: l.length },
      { id: 'active' as const, label: 'Rodando', n: l.filter(r => isActive(r.status)).length },
      { id: 'attention' as const, label: 'Precisam de você', n: l.filter(r => this.attention(r)).length },
      { id: 'done' as const, label: 'Concluídas', n: l.filter(r => r.status === 'succeeded' && !r.waiting).length },
    ];
  });
  protected readonly list = computed(() => {
    const l = this.byAgent();
    switch (this.status()) {
      case 'active': return l.filter(r => isActive(r.status));
      case 'attention': return l.filter(r => this.attention(r));
      case 'done': return l.filter(r => r.status === 'succeeded' && !r.waiting);
      default: return l;
    }
  });
  protected setProject(slug: string | null): void { this.router.navigate([], { queryParams: { projeto: slug, agente: null }, queryParamsHandling: 'merge' }); }
  protected setAgent(id: number | null): void { this.router.navigate([], { queryParams: { agente: id }, queryParamsHandling: 'merge' }); }

  /** esperando você (login, acesso): resolvido, retoma de onde parou e abre a conversa */
  protected async resume(r: Run): Promise<void> {
    this.chatError.set(null);
    try { this.chat.openInPanel(await this.runs.resume(r.id)); } catch (e) { this.chatError.set((e as Error).message); }
  }
  protected readonly selected = computed<Run | null>(() => {
    const id = Number(this.query()?.get('run'));
    return this.runs.runs().find(r => r.id === id) ?? this.list()[0] ?? null;
  });
  /** a última fala do agente costuma repetir o resultado; mostra só o resultado */
  protected readonly events = computed(() => {
    const r = this.selected();
    const list = r ? this.runs.eventsOf(r.id)() : [];
    return list.filter((e, i) => !(e.kind === 'text' && list[i + 1]?.kind === 'result' && list[i + 1].text === e.text));
  });
  protected readonly elapsed = computed(() => {
    const r = this.selected();
    if (!r?.startedAt) return null;
    const ms = (r.finishedAt ?? new Date()).getTime() - r.startedAt.getTime();
    const min = Math.round(ms / 60000);
    return min < 1 ? 'menos de 1 min' : `${min} min`;
  });

  constructor() {
    // log sempre no fim quando chega evento novo
    effect(() => {
      this.events();
      const el = this.log()?.nativeElement;
      if (el) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight }));
    });
  }

  protected select(r: Run): void {
    this.router.navigate([], { queryParams: { run: r.id }, queryParamsHandling: 'merge' });
  }

  protected agent(id: number | null) { return id ? this.agents.byId().get(id) ?? null : null; }
  /** quando a pausa acaba: "às 15:00" (ou dia e hora, se não for hoje) */
  protected at(d: Date): string {
    const today = d.toDateString() === new Date().toDateString();
    return today ? `às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  protected runAgentName(runId: number): string { return this.agent(this.runs.runs().find(x => x.id === runId)?.agentId ?? null)?.name ?? 'execução'; }

  /** passar adiante: pausada, que falhou ou foi interrompida, e que ninguém assumiu ainda */
  protected readonly handingOff = signal(false);
  protected readonly handoffAgent = signal('');
  protected readonly handoffNote = signal('');
  protected canHandoff(r: Run): boolean {
    return (!!r.paused || r.status === 'failed' || r.status === 'killed') && !this.runs.runs().some(x => x.handoffFrom === r.id);
  }
  protected handedOff(r: Run): boolean { return this.runs.runs().some(x => x.handoffFrom === r.id); }
  protected async continueRun(r: Run): Promise<void> {
    this.chatError.set(null);
    try { await this.runs.continue(r.id); } catch (e) { this.chatError.set((e as Error).message); }
  }
  protected async unpause(r: Run): Promise<void> {
    this.chatError.set(null);
    try { await this.runs.unpause(r.id); } catch (e) { this.chatError.set((e as Error).message); }
  }
  protected async handoff(r: Run): Promise<void> {
    this.chatError.set(null);
    try {
      const n = await this.runs.handoff(r.id, Number(this.handoffAgent()) || null, this.handoffNote().trim() || null);
      this.handingOff.set(false); this.handoffNote.set(''); this.handoffAgent.set('');
      this.select(n);
    } catch (e) { this.chatError.set((e as Error).message); }
  }

  /** Continua a sessão desta execução como conversa, na tela Agentes. */
  protected async continueChat(r: Run): Promise<void> {
    this.chatError.set(null);
    try {
      const id = await this.chat.fromRun(r.id);
      this.router.navigate(['/agentes'], { queryParams: { conversa: id } });
    } catch (e) {
      this.chatError.set((e as Error).message);
    }
  }

  protected project(slug: string | null) {
    if (!slug) return null;
    return this.projects.bySlug().get(slug) ?? null;
  }

  protected openWorktree(r: Run): void {
    if (r.worktreePath) this.projects.openInVsCode(r.worktreePath);
  }

  protected openPr(r: Run): void {
    if (r.prUrl) this.projects.openExternal(r.prUrl);
  }

  protected time(d: Date): string {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
