import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { AgentsService } from '../../services/agents/agents.service';
import { ChatService } from '../../services/chat/chat.service';
import { DialogsService } from '../../services/dialogs/dialogs.service';
import { IdeasService } from '../../services/ideas/ideas.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { TasksService } from '../../services/tasks/tasks.service';
import { LayoutService } from '../../services/layout/layout.service';
import { Icon, IconName } from '../../ui/icon';
import { AvatarSource, ProjectAvatar } from '../../ui/project-avatar';

interface Command {
  section: string;
  label: string;
  hint?: string;
  icon?: IconName;
  avatar?: AvatarSource;
  run: () => void;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Ctrl+K: ir a qualquer lugar e fazer qualquer coisa pelo teclado. */
@Component({
  selector: 'app-command-palette',
  imports: [Icon, ProjectAvatar],
  host: { '(document:keydown.control.k)': 'toggle($event)' },
  template: `
    <dialog #dlg (close)="open.set(false)" aria-label="Comandos"
            class="mx-auto mt-[12vh] w-[min(640px,92vw)] overflow-hidden rounded-2xl border border-edge bg-panel p-0 text-text shadow-2xl">
      <div class="flex items-center gap-3 border-b border-edge px-4">
        <app-icon name="spark" [size]="18" class="text-frost" />
        <input #input class="flex-1 bg-transparent py-4 text-[16px] outline-none placeholder:text-faint" placeholder="Buscar projeto, agente, tarefa ou ação…"
               aria-label="Buscar" role="combobox" aria-controls="cmd-list" [attr.aria-activedescendant]="'cmd-' + active()"
               [value]="query()" (input)="query.set($any($event.target).value); active.set(0)" (keydown)="key($event)">
        <kbd class="rounded border border-edge px-1.5 font-mono text-[11px] text-faint">Esc</kbd>
      </div>
      <ul id="cmd-list" role="listbox" class="max-h-[55vh] overflow-y-auto p-2">
        @for (c of results(); track $index; let i = $index) {
          @if (i === 0 || results()[i - 1].section !== c.section) {
            <li class="px-3 pt-3 pb-1 text-[11.5px] font-semibold text-faint" role="presentation">{{ c.section }}</li>
          }
          <li [id]="'cmd-' + i" role="option" [attr.aria-selected]="i === active()" (mousedown)="$event.preventDefault()" (click)="run(c)" (mouseenter)="active.set(i)"
              class="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2" [class.bg-raise]="i === active()">
            @if (c.avatar) { <app-project-avatar [project]="c.avatar" [size]="22" /> }
            @else { <span class="grid size-[22px] place-items-center text-mute"><app-icon [name]="c.icon ?? 'chevron'" [size]="16" /></span> }
            <span class="min-w-0 flex-1 truncate">{{ c.label }}</span>
            @if (c.hint) { <span class="max-w-52 truncate text-[12px] text-faint">{{ c.hint }}</span> }
          </li>
        } @empty {
          <li class="px-4 py-6 text-center text-mute">Nada encontrado. Que tal perguntar à Central?</li>
        }
      </ul>
    </dialog>`,
})
export class CommandPalette {
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);
  private readonly dialogs = inject(DialogsService);
  private readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly chat = inject(ChatService);
  private readonly tasks = inject(TasksService);
  private readonly ideas = inject(IdeasService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly active = signal(0);

  private readonly commands = computed<Command[]>(() => {
    const go = (url: string) => () => this.router.navigateByUrl(url);
    const talk = (id: number) => () => { this.chat.selectAgent(id); this.chat.open.set(true); };
    return [
      { section: 'Ações', label: 'Nova tarefa', icon: 'plus', run: () => this.dialogs.newTask() },
      { section: 'Ações', label: 'Mandar tarefa para um agente', icon: 'play', run: () => this.dialogs.newRun() },
      { section: 'Ações', label: 'Conversar com a Central', icon: 'central', hint: 'Ctrl+J', run: () => { const c = this.agents.central(); if (c) talk(c.id)(); } },
      { section: 'Ações', label: 'Deixar evoluindo esta noite', icon: 'night', run: () => this.dialogs.newTurn() },
      { section: 'Ações', label: 'Anotar ideia', icon: 'ideas', run: go('/ideias') },
      { section: 'Ações', label: 'Novo projeto', icon: 'folder', run: () => this.dialogs.newProject() },
      { section: 'Ações', label: 'Novo agente', icon: 'agent', run: go('/agentes?criar=1') },
      { section: 'Ações', label: 'Nova rotina', icon: 'routine', run: go('/rotinas?nova=1') },
      { section: 'Ações', label: 'Importar pendências', icon: 'download', hint: 'memórias, roadmaps, PRs', run: () => { this.ideas.importPending(); this.router.navigateByUrl('/ideias'); } },
      { section: 'Ações', label: 'Sincronizar repositórios', icon: 'sync', run: () => this.projects.sync() },
      { section: 'Ações', label: 'Abrir a Grade (sessões lado a lado)', icon: 'grid', run: go('/grade') },
      { section: 'Ações', label: 'Modo foco na Grade', icon: 'focus', hint: 'F11', run: () => { this.router.navigateByUrl('/grade'); this.layout.setFocus(true); } },
      { section: 'Ações', label: 'Preferências', icon: 'settings', run: () => this.dialogs.settings.set(true) },
      { section: 'Ações', label: 'Atualizar a Central', icon: 'download', run: () => this.dialogs.update.set(true) },
      ...[
        ['Início', '/', 'home'], ['Visão geral', '/visao-geral', 'overview'], ['Decisões', '/decisoes', 'inbox'], ['Ideias', '/ideias', 'ideas'],
        ['Backlog', '/backlog', 'kanban'], ['Agentes', '/agentes', 'agent'], ['Execuções', '/execucoes', 'activity'], ['Rotinas', '/rotinas', 'routine'],
      ].map(([label, url, icon]) => ({ section: 'Telas', label, icon: icon as IconName, run: go(url) })),
      ...this.projects.living().map(p => ({ section: 'Projetos', label: p.name, avatar: p, hint: p.lastCommitSubject ?? undefined, run: go(`/projetos/${p.slug}`) })),
      ...this.agents.agents().map(a => ({ section: 'Agentes', label: `Conversar com ${a.name}`, avatar: a, hint: a.description ?? undefined, run: talk(a.id) })),
      ...this.tasks.tasks().filter(t => t.column !== 'done').map(t => ({
        section: 'Tarefas', label: t.title, icon: 'kanban' as IconName, hint: this.projects.bySlug().get(t.projectSlug)?.name, run: () => this.dialogs.editTask(t.id),
      })),
      ...this.ideas.fresh().map(i => ({ section: 'Ideias', label: i.title, icon: 'ideas' as IconName, hint: i.projectSlug ? this.projects.bySlug().get(i.projectSlug)?.name : undefined, run: go('/ideias') })),
    ];
  });

  protected readonly results = computed(() => {
    const words = fold(this.query()).split(/\s+/).filter(Boolean);
    if (!words.length) return this.commands().filter(c => c.section === 'Ações' || c.section === 'Telas' || c.section === 'Projetos').slice(0, 30);
    return this.commands().filter(c => { const hay = fold(`${c.label} ${c.hint ?? ''} ${c.section}`); return words.every(w => hay.includes(w)); }).slice(0, 50);
  });

  constructor() {
    effect(() => {
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (this.open() && !el.open) { el.showModal(); queueMicrotask(() => this.input()?.nativeElement.focus()); }
      if (!this.open() && el.open) el.close();
    });
  }

  protected toggle(e: Event): void {
    e.preventDefault();
    this.query.set('');
    this.active.set(0);
    this.open.update(o => !o);
  }

  protected run(c: Command): void {
    this.open.set(false);
    c.run();
  }

  protected key(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set((this.active() + 1) % Math.max(n, 1)); this.scroll(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set((this.active() - 1 + n) % Math.max(n, 1)); this.scroll(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const c = this.results()[this.active()];
      if (c) this.run(c);
      else if (this.query().trim()) { this.open.set(false); this.askCentral(this.query()); }
    }
  }

  /** sem resultado: Enter manda a pergunta para a Central */
  private askCentral(text: string): void {
    const c = this.agents.central();
    if (!c) return;
    this.chat.selectAgent(c.id);
    this.chat.newChat(c.id);
    this.chat.open.set(true);
    this.chat.send(text);
  }

  private scroll(): void {
    queueMicrotask(() => document.getElementById(`cmd-${this.active()}`)?.scrollIntoView({ block: 'nearest' }));
  }
}
