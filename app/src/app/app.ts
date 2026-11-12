import { NgTemplateOutlet } from '@angular/common';
import { NotifSoundService } from './shared/services/notif-sound/notif-sound.service';
import { IS_WIN, IpcService } from './shared/services/ipc/ipc.service';
import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { QuickBar } from './shared/components/quick-bar/quick-bar';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ProjectDialog } from './shared/components/project-dialog/project-dialog';
import { RunDialog } from './shared/components/run-dialog/run-dialog';
import { TaskDialog } from './shared/components/task-dialog/task-dialog';
import { TurnDialog } from './shared/components/turn-dialog/turn-dialog';
import { UpdateDialog } from './shared/components/update-dialog/update-dialog';
import { CentralChat } from './shared/components/central-chat/central-chat';
import { ProjectEditDialog } from './shared/components/project-edit-dialog/project-edit-dialog';
import { ChatService } from './shared/services/chat/chat.service';
import { ProjectAvatar } from './shared/ui/project-avatar';
import { UsageMeter } from './shared/components/usage-meter/usage-meter';
import { UpdateService } from './shared/services/update/update.service';
import { IdeasService } from './shared/services/ideas/ideas.service';
import { TasksService } from './shared/services/tasks/tasks.service';
import { FindBar } from './shared/components/find-bar/find-bar';
import { needsYou } from './modules/inbox/pages/inbox-page/components/waiting-runs/waiting-runs';
import { DeliveriesService } from './shared/services/deliveries/deliveries.service';
import { TriageFocusService } from './shared/services/triage-focus/triage-focus.service';
import { DialogsService } from './shared/services/dialogs/dialogs.service';
import { Project, ProjectStatus } from './shared/services/projects/projects.model';
import { ProjectsService } from './shared/services/projects/projects.service';
import { ScopeService } from './shared/services/scope/scope.service';
import { ProposalsService } from './shared/services/proposals/proposals.service';
import { RunsService } from './shared/services/runs/runs.service';
import { AgoPipe } from './shared/ui/ago.pipe';
import { Icon, IconName } from './shared/ui/icon';
import { ContextMenu } from './shared/ui/context-menu';
import { SettingsDialog } from './shared/components/settings-dialog/settings-dialog';
import { CommandPalette } from './shared/components/command-palette/command-palette';
import { AskDialog } from './shared/components/ask-dialog/ask-dialog';
import { ImportSessionDialog } from './shared/components/import-session-dialog/import-session-dialog';
import { PrefsApiService } from './shared/services/prefs/prefs-api.service';
import { ContextMenuService, MenuEntry } from './shared/services/context-menu/context-menu.service';
import { AgentsService } from './shared/services/agents/agents.service';
import { Router } from '@angular/router';
import { STATUS_LABEL } from './shared/services/projects/projects.model';
import { LayoutService } from './shared/services/layout/layout.service';
import { LiveService } from './shared/services/live/live.service';
import { SessionsService } from './shared/services/sessions/sessions.service';

type NavItem = { path: string; label: string; icon: IconName; tabs?: { path: string; label: string }[]; also?: string[] };

/** telas de operação: no modo diretor ficam nos Bastidores (o ícone dele acende nelas) */
const BACKSTAGE = ['/bastidores', '/painel', '/visao-geral', '/triagem', '/ideias', '/revisao', '/backlog', '/quadros', '/agentes', '/execucoes', '/rotinas', '/escritorio', '/grade', '/extensoes'];

const GROUPS: { status: ProjectStatus; label: string }[] = [
  { status: 'active', label: 'Ativos' },
  { status: 'maintenance', label: 'Em manutenção' },
  { status: 'frozen', label: 'Congelados' },
];

@Component({
  selector: 'app-root',
  host: { '(document:keydown.f11)': 'toggleFocus($event)' },
  imports: [CdkDropList, CdkDrag, CdkDragPlaceholder, NgTemplateOutlet, RouterOutlet, RouterLink, RouterLinkActive, Icon, AgoPipe, ProjectDialog, RunDialog, TaskDialog, TurnDialog, UsageMeter, UpdateDialog, ProjectEditDialog, CentralChat, ProjectAvatar, ContextMenu, SettingsDialog, CommandPalette, ImportSessionDialog, QuickBar, AskDialog, FindBar],
  templateUrl: './app.html',
})
export class App {
  /** botões da janela: à direita no Windows, à esquerda no Mac */
  protected readonly isWin = IS_WIN;
  /** toca o som escolhido quando chega um aviso (mesmo com as Preferências fechadas) */
  private readonly notifSound = inject(NotifSoundService);
  protected readonly projects = inject(ProjectsService);
  protected readonly scope = inject(ScopeService);
  protected readonly proposals = inject(ProposalsService);
  protected readonly runs = inject(RunsService);
  protected readonly dialogs = inject(DialogsService);
  protected readonly ideas = inject(IdeasService);
  protected readonly tasks = inject(TasksService);
  private readonly deliveries = inject(DeliveriesService);
  private readonly focus = inject(TriageFocusService);
  protected readonly update = inject(UpdateService);
  protected readonly chat = inject(ChatService);
  private readonly menu = inject(ContextMenuService);
  private readonly agents = inject(AgentsService);
  private readonly router = inject(Router);
  private readonly ipc = inject(IpcService);
  protected readonly layout = inject(LayoutService);
  private readonly live = inject(LiveService);
  /** quantos estão trabalhando agora (selo do Escritório) */
  protected readonly working = computed(() => this.live.items().size + this.live.terminalsBusy().size);
  private readonly sessionsService = inject(SessionsService);

  /** barra de ícones: telas irmãs ficam juntas num ícone e viram abas no topo da tela (as rotas antigas continuam valendo) */
  private readonly operatorNav: NavItem[] = [
    { path: '/', label: 'Cockpit', icon: 'desk', tabs: [{ path: '/', label: 'Cockpit' }, { path: '/painel', label: 'Painel' }, { path: '/visao-geral', label: 'Visão geral' }] },
    { path: '/triagem', label: 'Triagem e ideias', icon: 'inbox', tabs: [{ path: '/triagem', label: 'Triagem' }, { path: '/ideias', label: 'Ideias' }] },
    { path: '/revisao', label: 'Revisão (entregas esperando o seu olhar)', icon: 'pr' },
    { path: '/estudio', label: 'Estúdio (rumo, time e piloto automático)', icon: 'compass' },
    { path: '/backlog', label: 'Backlog e quadros', icon: 'kanban', tabs: [{ path: '/backlog', label: 'Backlog' }, { path: '/quadros', label: 'Quadros' }] },
    { path: '/agentes', label: 'Agentes e execuções', icon: 'agent', tabs: [{ path: '/agentes', label: 'Agentes' }, { path: '/execucoes', label: 'Execuções' }] },
    { path: '/rotinas', label: 'Rotinas (agentes e scripts na agenda)', icon: 'routine' },
    { path: '/escritorio', label: 'Escritório (o time trabalhando)', icon: 'office' },
    { path: '/grade', label: 'Grade (sessões lado a lado)', icon: 'grid' },
    { path: '/utils', label: 'Utils (pull requests e outras ferramentas)', icon: 'tools' },
  ];
  /** modo diretor (padrão): a Mesa, o Estúdio e os Bastidores; o resto mora nos Bastidores */
  /** telas que dá para fixar na barra do modo diretor (botão direito na barra) */
  private readonly pinnable = computed(() => this.operatorNav.filter(n => n.path !== '/' && n.path !== '/estudio' && n.path !== '/utils'));
  private readonly directorNav = computed<NavItem[]>(() => {
    const pinned = this.pinnable().filter(n => this.layout.pinned().includes(n.path));
    const lit = new Set(pinned.flatMap(n => (n.tabs ?? [n]).map(t => t.path)));
    return [
      { path: '/', label: 'Cockpit (seus produtos, o que é seu e o chefe de gabinete)', icon: 'desk', also: ['/produtos'] },
      ...pinned,
      // os Bastidores acendem nas telas de operação que não estão fixadas
      { path: '/utils', label: 'Utils (pull requests e outras ferramentas)', icon: 'tools' },
      { path: '/bastidores', label: 'Bastidores (a operação por dentro; botão direito na barra fixa telas aqui)', icon: 'layers', also: BACKSTAGE.filter(p => !lit.has(p)) },
    ];
  });
  protected readonly navItems = computed(() => (this.layout.operator() ? this.operatorNav : this.directorNav()));

  /** botão direito na barra: escolher o que aparece */
  protected railMenu(e: MouseEvent): void {
    e.preventDefault();
    const on = this.layout.operator();
    this.menu.open(e, [
      ...this.pinnable().map(n => {
        const pinned = on || this.layout.pinned().includes(n.path);
        return { label: n.label.replace(/\s*\(.*\)$/, ''), icon: pinned ? 'check' as const : n.icon, hint: pinned ? 'na barra' : undefined,
          disabled: on, run: () => this.layout.togglePin(n.path) };
      }),
      null,
      { label: on ? 'Voltar ao modo diretor (barra enxuta)' : 'Modo operador (todas as telas)', icon: 'layers', run: () => this.layout.setOperator(!on) },
    ]);
  }
  /** no cockpit e na sala do produto (modo diretor), a lista de projetos sai: os produtos já estão na tela */
  protected readonly bareDesk = computed(() => !this.layout.operator() && (this.scope.path() === '/' || this.scope.path().startsWith('/produtos/')));
  /** no cockpit o chefe de gabinete já mora na coluna: o painel flutuante não abre por cima */
  protected readonly onCockpit = computed(() => this.scope.path() === '/');
  /** o que é do Gustavo (selo da Mesa): histórias para usar, decisões e agentes esperando ele */
  protected readonly forYou = computed(() => {
    const byTask = new Map(this.tasks.tasks().map(t => [t.id, t]));
    const stories = this.deliveries.board().filter(d => d.status === 'review' && d.taskId && (byTask.get(d.taskId)?.subtasks ?? 0) > 0).length;
    return stories + this.proposals.inbox().length + this.runs.waiting().length;
  });
  private readonly under = (path: string, tab: string) => (tab === '/' ? path === '/' : path === tab || path.startsWith(tab + '/'));
  /** ícone aceso: a tela atual é ele ou uma das abas dele */
  protected isOn(n: NavItem): boolean { const p = this.scope.path(); return [...(n.tabs ?? [n]).map(t => t.path), ...(n.also ?? [])].some(t => this.under(p, t)); }
  protected isHere(tab: string): boolean { return this.under(this.scope.path(), tab); }
  /** abas da tela atual (só quando ela faz parte de um grupo) */
  protected readonly tabs = computed(() => this.navItems().find(n => n.tabs && this.isOn(n))?.tabs ?? null);
  /** última aba aberta de cada grupo: o ícone volta para ela */
  private readonly lastTab = new Map<string, string>();
  private readonly rememberTab = effect(() => {
    const p = this.scope.path();
    for (const n of this.navItems()) { const t = n.tabs?.find(x => this.under(p, x.path)); if (t) this.lastTab.set(n.path, t.path); }
  });
  protected target(n: NavItem): string { return n.also ? n.path : this.isOn(n) ? n.path : this.lastTab.get(n.path) ?? n.path; }

  /** número no ícone da navegação */
  protected badge(path: string): { n: number; tone: string } | null {
    const all = this.runs.runs();
    const triage = this.proposals.inbox().filter(p => this.focus.decision(p)).length + this.ideas.unseen().filter(i => this.focus.idea(i)).length + all.filter(r => needsYou(r, all)).length;
    if (path === '/' && !this.layout.operator()) { const n = this.forYou(); return n ? { n, tone: 'bg-later text-night' } : null; }
    if (path === '/triagem' && triage) return { n: triage, tone: 'bg-later text-night' };
    if (path === '/ideias' && this.ideas.waiting().length) return { n: this.ideas.waiting().length, tone: 'bg-edge text-text' };
    // revisão: entregas na fila + tarefas em Revisão sem entrega (o mesmo que a tela Revisão lista)
    if (path === '/revisao') {
      const covered = new Set(this.deliveries.board().map(d => d.taskId));
      const n = this.deliveries.board().length + this.tasks.tasks().filter(t => t.column === 'review' && !covered.has(t.id)).length;
      return n ? { n, tone: 'bg-frost text-night' } : null;
    }
    return null;
  }

  /** primeiro nível por status (subprojetos aparecem dentro do grupo deles), na ordem que você arrastou */
  protected readonly groups = computed(() => {
    const has = this.projects.bySlug();
    return GROUPS.map(g => ({
      ...g,
      items: this.projects.projects().filter(p => p.status === g.status && !(p.parentSlug && has.has(p.parentSlug))).sort((a, b) => a.position - b.position),
    })).filter(g => g.items.length);
  });
  /** grupos recolhidos na barra lateral (fica salvo neste computador) */
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set(JSON.parse(localStorage.getItem('sidebar:collapsed') ?? '[]')));

  protected toggleGroup(e: Event, slug: string): void {
    e.preventDefault();
    e.stopPropagation();
    const next = new Set(this.collapsed());
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    this.collapsed.set(next);
    localStorage.setItem('sidebar:collapsed', JSON.stringify([...next]));
  }

  protected drop(e: CdkDragDrop<Project[]>): void {
    if (e.previousIndex === e.currentIndex) return;
    const list = [...e.container.data];
    moveItemInArray(list, e.previousIndex, e.currentIndex);
    this.projects.reorder(list.map(p => p.slug));
  }
  protected readonly showDead = signal(false);
  /** reavalia o "há X min" da barra de status */
  protected readonly tick = signal(0);

  constructor() {
    // "#67" nos textos (markdown e cards): abre a tarefa (ou a execução). Na captura, para não marcar a opção em volta
    document.addEventListener('click', e => {
      const a = (e.target as HTMLElement | null)?.closest?.('a.ref-link') as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute('href')!;
      if (href.startsWith('#abrir:')) {
        const path = decodeURIComponent(href.slice(7));
        const ctx = a.closest<HTMLElement>('[data-run],[data-chat],[data-project]');
        const num = (v: string | undefined) => (v ? Number(v) || null : null);
        this.ipc.invoke('shell:open', path, { run: num(ctx?.dataset['run']), chat: num(ctx?.dataset['chat']), project: ctx?.dataset['project'] || null }).then(r => {
          if (r === 'missing') alert(`Não achei este caminho nesta máquina:\n${path}`);
          else if (r === 'error') alert(`Não consegui abrir:\n${path}`);
        });
        return;
      }
      const [, kind, n] = href.match(/^#(tarefa|execucao)-(\d+)$/) ?? [];
      const id = Number(n);
      if (!id) return;
      if (kind === 'tarefa' && this.tasks.tasks().some(t => t.id === id)) this.dialogs.editTask(id);
      else if (this.runs.runs().some(r => r.id === id)) this.router.navigate(['/execucoes'], { queryParams: { run: id } });
    }, true);
    // Mac: Cmd+J, Cmd+K e Cmd+Enter fazem o que Ctrl faz no Windows (os atalhos escutam Ctrl); Cmd+C/V/X/A/Z seguem nativos
    if (!IS_WIN) document.addEventListener('keydown', e => {
      if (!e.metaKey || e.ctrlKey || !['j', 'k', 'enter'].includes(e.key.toLowerCase())) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      (e.target ?? document).dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: true, shiftKey: e.shiftKey, bubbles: true, cancelable: true }));
    }, true);
    // clicar no fundo escuro de qualquer modal fecha, como o Esc (requestClose dispara o mesmo cancel/close que cada
    // modal já trata). Só se o clique começou e terminou fora da caixa: arrastar uma seleção até fora não fecha.
    const backdrop = (e: MouseEvent): HTMLDialogElement | null => {
      const d = e.target;
      if (!(d instanceof HTMLDialogElement) || !d.open) return null;
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom ? d : null;
    };
    let pressed: HTMLDialogElement | null = null;
    document.addEventListener('mousedown', e => { pressed = backdrop(e); });
    document.addEventListener('click', e => {
      const d = backdrop(e);
      if (d && d === pressed) {
        const dlg = d as HTMLDialogElement & { requestClose?: () => void };
        if (dlg.requestClose) dlg.requestClose(); else dlg.close();
      }
      pressed = null;
    });
    setInterval(() => this.tick.update(t => t + 1), 30_000);
    // clique numa notificação ou no menu da bandeja
    inject(PrefsApiService).onNavigate(route => this.router.navigateByUrl(route));
  }

  protected runningIn(p: Project): boolean {
    return this.runs.active().some(r => r.projectSlug === p.slug)
      || this.live.chats().some(a => this.chat.chats().find(c => c.id === a.ref)?.projectSlug === p.slug)
      || [...this.live.terminalsBusy().keys()].some(id => this.sessionsService.byId().get(id)?.projectSlug === p.slug);
  }

  /** F11: modo foco, a partir da Grade (em outra tela, leva para ela) */
  protected toggleFocus(e: Event): void {
    e.preventDefault();
    if (!this.layout.focus() && !this.router.url.startsWith('/grade')) this.router.navigateByUrl('/grade');
    this.layout.toggleFocus();
  }

  /** mesma tecla do atalho: a paleta escuta Ctrl+K no documento */
  protected openPalette(): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  }

  /** Botão direito num projeto da lista. */
  /** clique no projeto: nas telas com escopo filtra a tela (de novo no mesmo = todos); nas outras abre a página dele */
  protected pickProject(e: MouseEvent, p: Project): void {
    if (!this.scope.scopable()) return;
    e.preventDefault();
    this.scope.set(this.scope.is(p.slug) ? null : p.slug);
  }
  protected openProject(e: Event, slug: string): void {
    e.preventDefault(); e.stopPropagation();
    this.router.navigate(['/projetos', slug]);
  }

  /** número da marca da tela aberta neste projeto (grupo fechado soma as frentes) */
  protected markOf(p: Project): number {
    const m = this.scope.marks();
    if (!m) return 0;
    const own = m.counts.get(p.slug) ?? 0;
    return this.collapsed().has(p.slug) ? own + this.projects.children(p.slug).reduce((n, c) => n + (m.counts.get(c.slug) ?? 0), 0) : own;
  }

  protected projectMenu(e: MouseEvent, p: Project): void {
    const go = (aba?: string) => this.router.navigate(['/projetos', p.slug], { queryParams: aba ? { aba } : {} });
    const agent = this.agents.agents().find(a => a.projectSlug === p.slug);
    const status: MenuEntry[] = (['active', 'maintenance', 'frozen', 'dead'] as ProjectStatus[])
      .filter(s => s !== p.status)
      .map(s => ({ label: `Marcar como ${STATUS_LABEL[s].toLowerCase()}`, icon: s === 'dead' ? 'archive' as const : 'flag' as const, run: () => this.projects.setStatus(p.slug, s) }));
    this.menu.open(e, [
      { label: 'Abrir', icon: 'terminal', run: () => go() },
      { label: 'Rumo do projeto', icon: 'flag', run: () => go('rumo') },
      { label: 'Backlog', icon: 'kanban', run: () => go('backlog') },
      { label: 'Conversa com o Claude', img: 'file-icons/claude.svg', run: () => this.router.navigate(['/projetos', p.slug], { queryParams: { nova: 'chat' } }) },
      { label: 'Novo terminal', img: 'file-icons/powershell.svg', run: () => this.router.navigate(['/projetos', p.slug], { queryParams: { nova: 'shell' } }) },
      null,
      ...(!p.parentSlug ? [{ label: 'Criar subprojeto (frente)…', icon: 'folder' as const, run: () => this.dialogs.newProject(p.slug) }] : []),
      ...(p.parentSlug ? [{ label: 'Tirar do grupo', icon: 'unarchive' as const, run: () => this.projects.edit(p.slug, { parentSlug: null }) }] : []),
      { label: 'Nova tarefa', icon: 'plus', run: () => this.dialogs.newTask({ projectSlug: p.slug }) },
      { label: 'Mandar para um agente', icon: 'play', run: () => this.dialogs.newRun({ projectSlug: p.slug }) },
      { label: agent ? `Conversar com ${agent.name}` : 'Criar agente para o projeto', icon: 'central',
        run: () => agent ? this.router.navigate(['/agentes'], { queryParams: { agente: agent.id } }) : this.router.navigate(['/agentes'], { queryParams: { novo: p.slug } }) },
      null,
      { label: 'Editar projeto…', icon: 'edit', run: () => this.dialogs.editProject.set(p.slug) },
      { label: 'Trocar ícone…', icon: 'spark', run: () => this.dialogs.editProject.set(p.slug) },
      ...status,
      null,
      { label: 'Abrir pasta', icon: 'folder', run: () => this.projects.reveal(p.folder), disabled: !p.folderExists },
      { label: 'Abrir no VS Code', icon: 'code', run: () => this.projects.openInVsCode(p.folder), disabled: !p.folderExists },
      { label: 'Sincronizar', icon: 'sync', run: () => this.projects.sync(p.slug) },
      null,
      { label: 'Excluir da Central…', icon: 'delete', danger: true, run: () => this.dialogs.editProject.set(p.slug) },
    ]);
  }
}
