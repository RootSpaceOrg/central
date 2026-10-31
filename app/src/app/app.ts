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

const GROUPS: { status: ProjectStatus; label: string }[] = [
  { status: 'active', label: 'Ativos' },
  { status: 'maintenance', label: 'Em manutenção' },
  { status: 'frozen', label: 'Congelados' },
];

@Component({
  selector: 'app-root',
  imports: [NgTemplateOutlet, RouterOutlet, RouterLink, RouterLinkActive, Icon, AgoPipe, ProjectDialog, RunDialog, TaskDialog, TurnDialog, UsageMeter, UpdateDialog, ProjectEditDialog, CentralChat, ProjectAvatar],
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

  protected readonly nav: { path: string; label: string; icon: IconName; exact?: boolean }[] = [
    { path: '/', label: 'Início', icon: 'home', exact: true },
    { path: '/visao-geral', label: 'Visão geral', icon: 'overview' },
    { path: '/decisoes', label: 'Decisões', icon: 'inbox' },
    { path: '/ideias', label: 'Ideias', icon: 'ideas' },
    { path: '/backlog', label: 'Backlog', icon: 'kanban' },
    { path: '/agentes', label: 'Agentes', icon: 'agent' },
    { path: '/rotinas', label: 'Rotinas', icon: 'routine' },
  ];

  /** número no ícone da navegação */
  protected badge(path: string): { n: number; tone: string } | null {
    if (path === '/decisoes' && this.proposals.inbox().length) return { n: this.proposals.inbox().length, tone: 'bg-later text-night' };
    if (path === '/ideias' && this.ideas.fresh().length) return { n: this.ideas.fresh().length, tone: 'bg-edge text-text' };
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
  }

  protected runningIn(p: Project): boolean {
    return this.runs.active().some(r => r.projectSlug === p.slug);
  }
}
