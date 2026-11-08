import { AgentList } from '../../../../shared/components/agent-list/agent-list';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ChatView } from '../../../../shared/components/chat-view/chat-view';
import { Agent, AgentsService, MODELS } from '../../../../shared/services/agents/agents.service';
import { AskService } from '../../../../shared/services/ask/ask.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { ContextMenuService } from '../../../../shared/services/context-menu/context-menu.service';
import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { MemoriesService } from '../../../../shared/services/memories/memories.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ScopeService } from '../../../../shared/services/scope/scope.service';
import { RUN_STATUS_LABEL, isActive } from '../../../../shared/services/runs/runs.model';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { SettingsApiService } from '../../../../shared/services/settings/settings-api.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';
import { AgentDialog, AgentDialogState } from '../../components/agent-dialog/agent-dialog';
import { MemoryPanel, MemoryView } from '../../components/memory-panel/memory-panel';

type Pane = 'conversas' | 'execucoes' | 'memoria';
/** 'all' = todos; '-' = sem projeto; senão o slug do projeto (as frentes contam como o projeto-pai) */
type Filter = string;

/**
 * Agentes: filtro por projeto no topo, os agentes em abas, e o agente escolhido com Conversa (chat no centro e o
 * histórico numa gaveta à direita), Execuções e Memória. A Central fica sempre à mão, em qualquer filtro.
 */
@Component({
  selector: 'app-agents-page',
  imports: [AgentList, RouterLink, Icon, AgoPipe, ProjectAvatar, ChatView, AgentDialog, MemoryPanel],
  templateUrl: './agents-page.html',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class AgentsPage {
  private readonly ask = inject(AskService);
  protected readonly agents = inject(AgentsService);
  protected readonly chat = inject(ChatService);
  protected readonly projects = inject(ProjectsService);
  protected readonly runs = inject(RunsService);
  protected readonly dialogs = inject(DialogsService);
  protected readonly memories = inject(MemoriesService);
  private readonly settings = inject(SettingsApiService);
  private readonly menu = inject(ContextMenuService);
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  protected readonly dialog = signal<AgentDialogState>(null);
  protected readonly pane = signal<Pane>('conversas');
  protected readonly memView = signal<MemoryView>('dele');
  protected readonly history = signal(false);
  private readonly scope = inject(ScopeService);
  protected readonly filter = computed<Filter>(() => this.scope.slug() ?? 'all');
  protected readonly runLabel = RUN_STATUS_LABEL;
  protected readonly isActive = isActive;

  protected readonly selected = computed(() => this.chat.agent());
  protected readonly agentRuns = computed(() => this.runs.runs().filter(r => r.agentId === this.selected()?.id).slice(0, 60));
  protected readonly modelLabel = (m: string) => MODELS.find(x => x.value === m)?.label ?? m;


  protected readonly visible = computed(() => {
    const f = this.filter();
    const list = this.agents.agents();
    return f === 'all' ? list : list.filter(a => a.builtin || this.scope.matches(a.projectSlug));
  });

  /** agentes trabalhando agora (execução ativa ou conversa respondendo) */
  protected readonly busy = computed(() => {
    const s = new Set<number>();
    for (const r of this.runs.runs()) if (r.agentId && isActive(r.status)) s.add(r.agentId);
    for (const c of this.chat.chats()) if (this.chat.busy().has(c.id)) s.add(c.agentId);
    return s;
  });

  constructor() {
    this.settings.get('agents:history').then(v => this.history.set(v === '1'));
    // ?agente=3&conversa=12 (vindo do painel, de uma execução ou do menu de projeto); sem nada, onde você parou
    effect(() => {
      const q = this.query();
      const agentId = Number(q?.get('agente'));
      const chatId = Number(q?.get('conversa'));
      const novo = q?.get('novo');
      if (!this.agents.loaded()) return;
      untracked(() => {
        if (novo) this.dialog.set({ agent: null, projectSlug: novo });
        else if (q?.get('criar')) this.dialog.set({ agent: null });
        if (chatId) this.chat.select(chatId);
        else if (agentId) this.chat.selectAgent(agentId);
        else this.chat.restoreLast();
      });
    });
    // trocou o projeto na barra lateral: se o agente aberto não é dele, abre o primeiro agente do projeto
    effect(() => {
      const f = this.filter(), cur = this.selected();
      if (f === 'all' || !this.agents.loaded() || (cur && (cur.builtin || this.scope.matches(cur.projectSlug)))) return;
      const first = untracked(() => this.visible().find(a => !a.builtin) ?? this.visible().find(a => a.builtin));
      if (first) untracked(() => this.pick(first));
    });
  }

  /** coluna de agentes: trabalhando agora e, sem projeto escolhido, de qual projeto é */
  protected readonly listItems = computed(() => this.visible().map(a => ({
    agent: a, live: this.busy().has(a.id),
    hint: a.builtin ? 'a Central' : this.filter() === 'all' ? (this.project(a.projectSlug)?.name ?? 'sem projeto') : (a.description ?? null),
  })));
  protected pickId(id: number | null): void { const a = this.visible().find(x => x.id === id); if (a) this.pick(a); }

  protected pick(a: Agent): void {
    this.chat.selectAgent(a.id);
    this.router.navigate([], { queryParams: { agente: a.id, conversa: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }


  protected toggleHistory(): void { const v = !this.history(); this.history.set(v); this.settings.set('agents:history', v ? '1' : '0'); }

  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected newRun(a: Agent): void { this.dialogs.newRun({ agentId: a.id, projectSlug: a.projectSlug }); }
  protected newRoutine(a: Agent): void { this.router.navigate(['/rotinas'], { queryParams: { nova: 1, agente: a.id } }); }

  protected closed(savedId: number | null): void {
    this.dialog.set(null);
    if (savedId) this.chat.selectAgent(savedId);
  }

  protected async rename(id: number, current: string): Promise<void> {
    const title = await this.ask.text('Nome da conversa', current);
    if (title?.trim()) this.chat.rename(id, title);
  }

  protected agentMenu(e: MouseEvent, a: Agent): void {
    this.menu.open(e, [
      { label: 'Conversar', icon: 'central', run: () => this.pick(a) },
      { label: 'Nova conversa', icon: 'plus', run: () => { this.pick(a); this.chat.newChat(a.id); } },
      { label: 'Mandar uma tarefa', icon: 'play', run: () => this.newRun(a) },
      { label: 'Nova rotina', icon: 'routine', run: () => this.newRoutine(a) },
      null,
      { label: 'Editar', icon: 'edit', run: () => this.dialog.set({ agent: a }) },
      ...(a.builtin ? [] : [{ label: 'Excluir', icon: 'delete' as const, danger: true, run: () => this.dialog.set({ agent: a }) }]),
    ]);
  }
}
