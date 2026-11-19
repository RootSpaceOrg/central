import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { OwnerState } from '../../shared/services/projects/projects.model';
import { DeliveriesService } from '../../shared/services/deliveries/deliveries.service';
import { GuidesService } from '../../shared/services/guides/guides.service';
import { IdeasService } from '../../shared/services/ideas/ideas.service';
import { IpcService } from '../../shared/services/ipc/ipc.service';
import { ProjectsService } from '../../shared/services/projects/projects.service';
import { ProposalsService } from '../../shared/services/proposals/proposals.service';
import { RoadmapService } from '../../shared/services/roadmap/roadmap.service';
import { TasksService } from '../../shared/services/tasks/tasks.service';
import { AgoPipe } from '../../shared/ui/ago.pipe';
import { Icon } from '../../shared/ui/icon';
import { MarkdownPipe } from '../../shared/ui/markdown';
import { ProjectAvatar } from '../../shared/ui/project-avatar';
import { CockpitService } from '../../modules/cockpit/services/cockpit/cockpit.service';
import { MobileScope } from '../scope';

/** Projetos no celular: a lista (grupos com as frentes), com o que está andando em cada um */
@Component({
  selector: 'app-mobile-projects',
  imports: [ProjectAvatar, RouterLink],
  host: { class: 'block px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8' },
  template: `
    <h1 class="font-display text-[24px] font-bold">Projetos</h1>
    <ul class="mt-4 space-y-2">
      @for (p of roots(); track p.slug) {
        <li>
          <a [routerLink]="['/projetos', p.slug]" class="flex items-center gap-3 rounded-2xl border border-edge bg-panel px-4 py-3 active:bg-raise">
            <app-project-avatar [project]="p" [size]="34" />
            <span class="min-w-0 flex-1"><span class="block truncate font-semibold">{{ p.name }}</span>
              <span class="block truncate text-[12.5px] text-mute">{{ line(p.slug) }}</span></span>
            @if (running(p.slug); as n) { <span class="flex items-center gap-1 rounded-full bg-yes/15 px-2 py-0.5 text-[12px] font-bold text-yes"><span class="pulse size-1.5 rounded-full bg-yes"></span>{{ n }}</span> }
          </a>
          @if (projects.children(p.slug).length) {
            <ul class="mt-1.5 ml-6 space-y-1.5 border-l border-edge pl-3">
              @for (c of projects.children(p.slug); track c.slug) {
                <li><a [routerLink]="['/projetos', c.slug]" class="flex items-center gap-2.5 rounded-xl bg-panel/60 px-3 py-2 active:bg-raise">
                  <app-project-avatar [project]="c" [size]="24" /><span class="min-w-0 flex-1 truncate text-[14px]">{{ c.name }}</span>
                  @if (running(c.slug); as n) { <span class="text-[12px] font-bold text-yes">● {{ n }}</span> }</a></li>
              }
            </ul>
          }
        </li>
      }
    </ul>`,
})
export class ProjectsPage {
  protected readonly projects = inject(ProjectsService);
  private readonly cockpit = inject(CockpitService);
  private readonly bySlug = computed(() => new Map(this.cockpit.companies().flatMap(c => c.products).map(p => [p.slug, p])));
  protected readonly roots = computed(() => this.projects.living().filter(p => !p.parentSlug).sort((a, b) => a.position - b.position));
  protected running(slug: string): number { return this.bySlug().get(slug)?.activeRuns ?? 0; }
  protected line(slug: string): string {
    const i = this.bySlug().get(slug);
    if (!i) return 'sem instrumentos';
    return [i.owner ? i.owner.name : 'sem dono', i.milestone ? `${i.milestone.title}${i.milestone.pct !== null ? ` · ${i.milestone.pct}%` : ''}` : null].filter(Boolean).join(' · ');
  }
}

const COLS: { id: string; label: string }[] = [
  { id: 'doing', label: 'Fazendo' }, { id: 'todo', label: 'A fazer' }, { id: 'review', label: 'Revisão' }, { id: 'backlog', label: 'Backlog' }, { id: 'dev', label: 'Em dev' },
];

/**
 * Um projeto no celular, para trabalhar sem o PC: o dono (age sozinho, procurar trabalho, falar, 1:1), o rumo, os marcos,
 * o backlog por coluna (com tarefa nova), as ideias (aprovar, descartar, nova), as decisões, as entregas e o diário.
 */
@Component({
  selector: 'app-mobile-project',
  imports: [AgoPipe, Icon, MarkdownPipe, ProjectAvatar, RouterLink],
  host: { class: 'block px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10' },
  template: `
    <a routerLink="/projetos" class="flex items-center gap-1 text-[13px] text-mute"><app-icon name="back" [size]="14" />Projetos</a>
    @if (project(); as p) {
      <header class="mt-3 flex items-center gap-3">
        <app-project-avatar [project]="p" [size]="44" />
        <div class="min-w-0 flex-1">
          <h1 class="truncate font-display text-[22px] font-bold leading-tight">{{ p.name }}</h1>
          @if (inst(); as i) { <p class="truncate text-[13px]" [class]="i.ownerState === 'working' ? 'text-yes' : i.ownerState === 'waiting' ? 'text-later' : 'text-mute'">@if (i.owner) { {{ i.owner.name }} · {{ stateLabel(i.ownerState) }} } @else { sem dono }</p> }
        </div>
      </header>

      <!-- o dono: pôr para andar -->
      @if (ownerId(); as oid) {
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button type="button" class="rounded-xl border border-edge bg-panel px-3 py-2.5 text-left text-[13.5px] font-semibold active:bg-raise" (click)="round(p.slug)">
            <app-icon name="search" [size]="14" class="mr-1 text-frost" />{{ rounding() ? 'Foi procurar…' : 'Procurar trabalho' }}</button>
          <button type="button" class="rounded-xl border border-edge bg-panel px-3 py-2.5 text-left text-[13.5px] font-semibold active:bg-raise" (click)="toggleOwner(p.slug, !p.ownerOn)">
            <span class="mr-1 inline-block size-2 rounded-full" [class]="p.ownerOn ? 'bg-yes' : 'bg-faint'"></span>{{ p.ownerOn ? 'Age sozinho' : 'Parado' }}</button>
          <a [routerLink]="['/conversas', 'novo', oid]" class="rounded-xl border border-edge bg-panel px-3 py-2.5 text-[13.5px] font-semibold active:bg-raise"><app-icon name="comments" [size]="14" class="mr-1 text-frost" />Falar com o dono</a>
          <button type="button" class="rounded-xl border border-[#B48CFF]/50 bg-[#B48CFF]/[0.08] px-3 py-2.5 text-left text-[13.5px] font-semibold text-[#C6A6FF] active:bg-raise" (click)="oneOnOne(p.slug)">
            {{ openGuide() ? 'Abrir o 1:1' : 'Começar 1:1' }}</button>
        </div>
      }
      @if (msg(); as m) { <p class="mt-2 text-[12.5px] text-mute">{{ m }}</p> }

      <!-- rumo e marcos -->
      @if (direction(); as d) {
        <details class="mt-5 rounded-2xl border border-edge bg-panel px-4 py-3">
          <summary class="text-[13px] font-bold uppercase tracking-wider text-faint">Rumo</summary>
          <div class="md mt-2 text-[14px] leading-relaxed" [innerHTML]="d | markdown"></div>
        </details>
      }
      @if (milestones().length) {
        <h2 class="mt-5 text-[11.5px] font-bold uppercase tracking-wider text-faint">Marcos</h2>
        <ul class="mt-2 space-y-2">
          @for (m of milestones(); track m.id) {
            <li class="rounded-xl border border-edge bg-panel px-4 py-2.5">
              <p class="flex items-center gap-2 text-[14px] font-semibold"><span class="rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase" [class]="m.horizon === 'now' ? 'bg-frost/15 text-frost' : 'bg-raise text-mute'">{{ m.horizon === 'now' ? 'Agora' : m.horizon === 'next' ? 'Próximo' : 'Depois' }}</span><span class="min-w-0 flex-1 truncate">{{ m.title }}</span></p>
              @if (m.tasks) { <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raise"><div class="h-full rounded-full" [style.width.%]="m.tasksDone / m.tasks * 100" [style.background]="p.color"></div></div> }
            </li>
          }
        </ul>
      }

      <!-- backlog -->
      <div class="mt-6 flex items-center gap-2">
        <h2 class="flex-1 text-[11.5px] font-bold uppercase tracking-wider text-faint">Backlog</h2>
        <button type="button" class="text-[13px] font-semibold text-frost" (click)="adding.set(adding() === 'task' ? null : 'task')">+ tarefa</button>
      </div>
      @if (adding() === 'task') {
        <div class="mt-2 rounded-2xl border border-frost/40 bg-panel p-3">
          <input class="field text-[14px]" placeholder="O que o usuário vai conseguir fazer?" [value]="newTitle()" (input)="newTitle.set($any($event.target).value)" aria-label="Título da tarefa" />
          <textarea class="field mt-2 h-20 text-[14px]" placeholder="Detalhes (opcional)" [value]="newBody()" (input)="newBody.set($any($event.target).value)" aria-label="Detalhes"></textarea>
          <div class="mt-2 flex gap-2"><button type="button" class="flex-1 rounded-xl border border-edge py-2 text-mute" (click)="addTask(p.slug, 'backlog')">No Backlog</button>
            <button type="button" class="flex-1 rounded-xl bg-frost py-2 font-semibold text-night" (click)="addTask(p.slug, 'todo')">A fazer (o time pega)</button></div>
        </div>
      }
      <div class="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        @for (c of cols; track c.id) {
          <button type="button" class="shrink-0 rounded-full px-3 py-1 text-[12.5px] font-semibold" [class]="col() === c.id ? 'bg-frost text-night' : 'bg-panel text-mute'" (click)="col.set(c.id)">
            {{ c.label }} {{ count(c.id) }}</button>
        }
      </div>
      <ul class="mt-2 space-y-1.5">
        @for (t of tasksIn(); track t.id) {
          <li class="rounded-xl border border-edge bg-panel px-3.5 py-2.5">
            <p class="text-[14px] leading-snug">{{ t.title }}</p>
            <p class="mt-0.5 flex gap-2 text-[11.5px] text-faint">#{{ t.id }}
              @if (t.subtasks) { <span>· {{ t.subtasksDone }}/{{ t.subtasks }} partes</span> }
              @if (t.runStatus === 'running') { <span class="text-yes">· agente trabalhando</span> }</p>
          </li>
        } @empty { <li class="py-3 text-center text-[13px] text-faint">Nada aqui.</li> }
      </ul>

      <!-- ideias -->
      <div class="mt-6 flex items-center gap-2">
        <h2 class="flex-1 text-[11.5px] font-bold uppercase tracking-wider text-faint">Ideias novas</h2>
        <button type="button" class="text-[13px] font-semibold text-frost" (click)="adding.set(adding() === 'idea' ? null : 'idea')">+ ideia</button>
      </div>
      @if (adding() === 'idea') {
        <div class="mt-2 rounded-2xl border border-frost/40 bg-panel p-3">
          <input class="field text-[14px]" placeholder="A ideia em uma linha" [value]="newTitle()" (input)="newTitle.set($any($event.target).value)" aria-label="Ideia" />
          <textarea class="field mt-2 h-20 text-[14px]" placeholder="Por quê, para quem (opcional)" [value]="newBody()" (input)="newBody.set($any($event.target).value)" aria-label="Detalhes da ideia"></textarea>
          <button type="button" class="mt-2 w-full rounded-xl bg-frost py-2 font-semibold text-night" (click)="addIdea(p.slug)">Anotar</button>
        </div>
      }
      <ul class="mt-2 space-y-1.5">
        @for (i of ideas(); track i.id) {
          <li class="rounded-xl border border-edge bg-panel px-3.5 py-2.5">
            <p class="text-[14px] font-semibold leading-snug">{{ i.title }}</p>
            @if (i.body) { <p class="mt-0.5 line-clamp-3 text-[12.5px] text-mute">{{ i.body }}</p> }
            <p class="mt-0.5 text-[11.5px] text-faint">{{ i.author === 'gustavo' ? 'você' : i.author }} · {{ i.createdAt | ago }}</p>
            <div class="mt-2 flex gap-2 text-[13px]">
              <button type="button" class="flex-1 rounded-lg bg-yes/15 py-1.5 font-semibold text-yes" (click)="idea(i.id, 'approved')">Aprovar</button>
              <button type="button" class="flex-1 rounded-lg border border-edge py-1.5 text-no" (click)="idea(i.id, 'archived')">Descartar</button>
            </div>
          </li>
        } @empty { <li class="py-3 text-center text-[13px] text-faint">Nenhuma ideia esperando.</li> }
      </ul>

      <!-- decisões e entregas deste projeto -->
      @if (decisions().length || reviews().length) {
        <a routerLink="/para-voce" class="mt-6 block rounded-2xl border border-later/40 bg-later/[0.06] px-4 py-3 text-[14px]">
          <b>{{ decisions().length }}</b> {{ decisions().length === 1 ? 'decisão' : 'decisões' }} e <b>{{ reviews().length }}</b> {{ reviews().length === 1 ? 'entrega' : 'entregas' }} esperando você <span class="text-later">→ Para você</span></a>
      }

      <!-- diário do dono -->
      @if (diary().length) {
        <h2 class="mt-6 text-[11.5px] font-bold uppercase tracking-wider text-faint">Diário do dono</h2>
        <ol class="mt-2 space-y-2">
          @for (d of diary(); track d.runId) {
            <li class="rounded-xl border border-edge bg-panel px-3.5 py-2.5">
              <p class="text-[11.5px] text-faint">{{ d.at | ago }} · {{ d.title }}</p>
              @if (d.diary) { <div class="md mt-1 line-clamp-6 text-[13px] leading-relaxed" [innerHTML]="d.diary | markdown"></div> }
            </li>
          }
        </ol>
      }
    } @else { <p class="mt-10 text-center text-mute">Carregando…</p> }`,
})
export class ProjectPage {
  readonly slug = input.required<string>();
  private readonly projects = inject(ProjectsService);
  private readonly cockpit = inject(CockpitService);
  private readonly tasks = inject(TasksService);
  private readonly ideasSvc = inject(IdeasService);
  private readonly roadmap = inject(RoadmapService);
  private readonly proposals = inject(ProposalsService);
  private readonly deliveries = inject(DeliveriesService);
  private readonly guides = inject(GuidesService);
  private readonly ipc = inject(IpcService);
  private readonly router = inject(Router);
  private readonly scope = inject(MobileScope);
  protected readonly cols = COLS;

  protected readonly project = computed(() => this.projects.bySlug().get(this.slug()) ?? null);
  protected readonly inst = computed(() => this.cockpit.companies().flatMap(c => c.products).find(p => p.slug === this.slug()) ?? null);
  protected readonly ownerId = computed(() => { const p = this.project(); return p ? p.ownerAgentId ?? p.todoAgentId : null; });
  protected readonly direction = signal<string | null>(null);
  private readonly info = signal<OwnerState | null>(null);
  protected readonly diary = computed(() => (this.info()?.diary ?? []).slice(0, 5));
  protected readonly milestones = computed(() => this.roadmap.all().filter(m => m.projectSlug === this.slug() && !m.doneAt && m.horizon !== 'later').slice(0, 6));
  protected readonly col = signal('doing');
  private readonly mine = computed(() => this.tasks.tasks().filter(t => t.projectSlug === this.slug() && !t.parentId));
  protected readonly tasksIn = computed(() => this.mine().filter(t => t.column === this.col()).slice(0, 30));
  protected readonly ideas = computed(() => this.ideasSvc.ideas().filter(i => i.projectSlug === this.slug() && i.status === 'new').slice(0, 15));
  protected readonly decisions = computed(() => this.proposals.inbox().filter(p => p.projectSlug === this.slug()));
  protected readonly reviews = computed(() => this.deliveries.board().filter(d => d.projectSlug === this.slug() && (d.status === 'review' || d.status === 'pending')));
  protected readonly openGuide = computed(() => this.guides.open().find(g => g.kind === 'dono' && g.projectSlug === this.slug()) ?? null);
  protected readonly adding = signal<'task' | 'idea' | null>(null);
  protected readonly newTitle = signal('');
  protected readonly newBody = signal('');
  protected readonly rounding = signal(false);
  protected readonly msg = signal<string | null>(null);

  constructor() {
    this.guides.load();
    effect(() => {
      const s = this.slug();
      untracked(() => {
        this.scope.set(s); // abrir um projeto escolhe ele nas outras abas também (como a barra lateral do PC)
        this.ipc.invoke('direction:get', s).then(d => this.direction.set(d?.text ?? null), () => this.direction.set(null));
        this.projects.owner(s).then(i => this.info.set(i), () => {});
        const first = COLS.find(c => this.mine().some(t => t.column === c.id));
        if (first) this.col.set(first.id);
      });
    });
  }

  protected count(c: string): number { return this.mine().filter(t => t.column === c).length; }
  protected stateLabel(s: string): string { return ({ working: 'trabalhando', waiting: 'esperando você', watching: 'atento', off: 'parado', none: 'sem dono' } as Record<string, string>)[s] ?? s; }

  protected async round(slug: string): Promise<void> {
    this.rounding.set(true);
    try { const r = await this.projects.ownerRound(slug); this.msg.set(r === null ? 'Ele já está numa passada.' : 'Foi procurar trabalho; o diário conta o que achou.'); }
    catch (e) { this.msg.set((e as Error).message); }
    finally { setTimeout(() => this.rounding.set(false), 4000); }
  }
  protected toggleOwner(slug: string, on: boolean): void { this.projects.setOwnerOn(slug, on).catch(e => this.msg.set((e as Error).message)); }
  protected async oneOnOne(slug: string): Promise<void> {
    const g = this.openGuide() ?? (await this.guides.start(slug, false, null, 'dono'));
    if (g) this.router.navigate(['/um-a-um', g.id]);
  }
  protected async addTask(slug: string, column: 'backlog' | 'todo'): Promise<void> {
    const title = this.newTitle().trim();
    if (!title) return;
    try {
      await this.ipc.invoke('tasks:create', { project_slug: slug, repo_path: null, title, body: this.newBody().trim() || null, column, priority: 2 } as never);
      this.tasks.load(); this.col.set(column); this.reset();
    } catch (e) { this.msg.set((e as Error).message); }
  }
  protected async addIdea(slug: string): Promise<void> {
    const title = this.newTitle().trim();
    if (!title) return;
    try { await this.ideasSvc.create(title, this.newBody().trim(), slug); this.reset(); } catch (e) { this.msg.set((e as Error).message); }
  }
  protected async idea(id: number, status: 'approved' | 'archived'): Promise<void> {
    try { await this.ipc.invoke('ideas:update', id, { status }); this.ideasSvc.load(); } catch (e) { this.msg.set((e as Error).message); }
  }
  private reset(): void { this.adding.set(null); this.newTitle.set(''); this.newBody.set(''); }
}
