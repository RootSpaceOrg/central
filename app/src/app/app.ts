import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
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
import { DialogsService } from './shared/services/dialogs/dialogs.service';
import { Project, ProjectStatus } from './shared/services/projects/projects.model';
import { ProjectsService } from './shared/services/projects/projects.service';
import { ProposalsService } from './shared/services/proposals/proposals.service';
import { RunsService } from './shared/services/runs/runs.service';
import { AgoPipe } from './shared/ui/ago.pipe';
import { Icon, IconName } from './shared/ui/icon';
import { ContextMenu } from './shared/ui/context-menu';
import { SettingsDialog } from './shared/components/settings-dialog/settings-dialog';
import { CommandPalette } from './shared/components/command-palette/command-palette';
import { ImportSessionDialog } from './shared/components/import-session-dialog/import-session-dialog';
import { PrefsApiService } from './shared/services/prefs/prefs-api.service';
import { ContextMenuService, MenuEntry } from './shared/services/context-menu/context-menu.service';
import { AgentsService } from './shared/services/agents/agents.service';
import { Router } from '@angular/router';
import { STATUS_LABEL } from './shared/services/projects/projects.model';
import { LayoutService } from './shared/services/layout/layout.service';

const GROUPS: { status: ProjectStatus; label: string }[] = [
  { status: 'active', label: 'Ativos' },
  { status: 'maintenance', label: 'Em manutenção' },
  { status: 'frozen', label: 'Congelados' },
];

@Component({
  selector: 'app-root',
  host: { '(document:keydown.f11)': 'toggleFocus($event)' },
  imports: [NgTemplateOutlet, RouterOutlet, RouterLink, RouterLinkActive, Icon, AgoPipe, ProjectDialog, RunDialog, TaskDialog, TurnDialog, UsageMeter, UpdateDialog, ProjectEditDialog, CentralChat, ProjectAvatar, ContextMenu, SettingsDialog, CommandPalette, ImportSessionDialog],
  templateUrl: './app.html',
})
export class App {
  protected readonly projects = inject(ProjectsService);
  protected readonly proposals = inject(ProposalsService);
  protected readonly runs = inject(RunsService);
  protected readonly dialogs = inject(DialogsService);
  protected readonly ideas = inject(IdeasService);
  protected readonly tasks = inject(TasksService);
  protected readonly update = inject(UpdateService);
  protected readonly chat = inject(ChatService);
  private readonly menu = inject(ContextMenuService);
  private readonly agents = inject(AgentsService);
  private readonly router = inject(Router);
  protected readonly layout = inject(LayoutService);

  protected readonly nav: { path: string; label: string; icon: IconName; exact?: boolean }[] = [
    { path: '/', label: 'Início', icon: 'home', exact: true },
    { path: '/visao-geral', label: 'Visão geral', icon: 'overview' },
    { path: '/triagem', label: 'Triagem (decisões e ideias novas)', icon: 'inbox' },
    { path: '/ideias', label: 'Ideias', icon: 'ideas' },
    { path: '/backlog', label: 'Backlog', icon: 'kanban' },
    { path: '/agentes', label: 'Agentes', icon: 'agent' },
    { path: '/execucoes', label: 'Execuções', icon: 'activity' },
    { path: '/rotinas', label: 'Rotinas', icon: 'routine' },
    { path: '/grade', label: 'Grade (sessões lado a lado)', icon: 'grid' },
  ];

  /** número no ícone da navegação */
  protected badge(path: string): { n: number; tone: string } | null {
    const triage = this.proposals.inbox().length + this.ideas.fresh().length;
    if (path === '/triagem' && triage) return { n: triage, tone: 'bg-later text-night' };
    if (path === '/ideias' && this.ideas.waiting().length) return { n: this.ideas.waiting().length, tone: 'bg-edge text-text' };
    const review = this.tasks.tasks().filter(t => t.column === 'review').length;
    if (path === '/backlog' && review) return { n: review, tone: 'bg-frost text-night' };
    return null;
  }

  protected readonly groups = computed(() =>
    GROUPS.map(g => ({ ...g, items: this.projects.projects().filter(p => p.status === g.status) })).filter(g => g.items.length));
  protected readonly showDead = signal(false);
  /** reavalia o "há X min" da barra de status */
  protected readonly tick = signal(0);

  constructor() {
    setInterval(() => this.tick.update(t => t + 1), 30_000);
    // clique numa notificação ou no menu da bandeja
    inject(PrefsApiService).onNavigate(route => this.router.navigateByUrl(route));
  }

  protected runningIn(p: Project): boolean {
    return this.runs.active().some(r => r.projectSlug === p.slug);
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
