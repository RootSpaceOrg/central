import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { BOARD_TEMPLATES, BoardService } from '../../../../shared/services/board/board.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ScopeService } from '../../../../shared/services/scope/scope.service';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';

/**
 * Quadros (workflows): fluxos com colunas e um agente por etapa, de um projeto ou soltos (agentes de vários projetos).
 * Uma tarefa pode estar em vários quadros e continua no backlog principal do projeto dela.
 */
@Component({
  selector: 'app-boards-page',
  imports: [RouterLink, Icon, ProjectAvatar, ProjectSelect],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-[1200px] px-10 pt-9 pb-16">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex-1">
          <h1 class="flex items-center gap-3 font-display text-[32px] font-bold leading-tight tracking-tight"><app-icon name="workflow" [size]="26" class="text-frost" />Quadros</h1>
          <p class="mt-1 max-w-2xl text-mute">Fluxos com colunas e um agente por etapa: a tarefa entra, cada agente faz a parte dele e passa adiante. A tarefa continua no backlog principal do projeto dela.</p>
        </div>
        <button type="button" class="btn btn-primary" (click)="creating.set(true)"><app-icon name="plus" [size]="16" />Novo quadro</button>
      </div>

      @if (creating()) {
        <section class="mt-6 rounded-3xl border border-frost/40 bg-panel p-6" aria-labelledby="novo-quadro">
          <h2 id="novo-quadro" class="font-display text-lg font-semibold">Novo quadro</h2>
          <div class="mt-3 grid grid-cols-[1.3fr_1fr] gap-3">
            <input class="field" placeholder="Nome (ex.: Conteúdo do KultivAi, Revisão de PRs)" [value]="name()" (input)="name.set($any($event.target).value)" aria-label="Nome do quadro" autofocus>
            <app-project-select [value]="project()" (valueChange)="project.set($event)" noneLabel="Nenhum (quadro solto, agentes de vários projetos)" />
          </div>
          <p class="mt-4 mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-faint">Comece com</p>
          <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Modelo">
            @for (t of templates; track t.id) {
              <button type="button" role="radio" [attr.aria-checked]="template() === t.id" (click)="template.set(t.id)"
                      class="rounded-2xl border px-4 py-3 text-left transition" [class]="template() === t.id ? 'border-frost/60 bg-frost/10' : 'border-edge bg-night hover:border-faint'">
                <span class="block font-semibold">{{ t.label }}</span>
                <span class="mt-0.5 block text-[12.5px] text-mute">{{ t.hint }}</span>
              </button>
            }
          </div>
          <p class="mt-3 text-[12.5px] text-mute">Os agentes de cada coluna você escolhe no próprio quadro (botão "Agente nesta coluna").</p>
          <div class="mt-4 flex items-center gap-2">
            @if (error()) { <p role="alert" class="text-[13px] text-no">{{ error() }}</p> }
            <span class="flex-1"></span>
            <button type="button" class="btn btn-ghost" (click)="creating.set(false)">Cancelar</button>
            <button type="button" class="btn btn-primary" [disabled]="!name().trim() || busy()" (click)="create()">Criar quadro</button>
          </div>
        </section>
      }

      <div class="mt-7 grid grid-cols-1 gap-4 lg:grid-cols-2">
        @for (b of shownBoards(); track b.id) {
          <a [routerLink]="['/quadros', b.id]" class="block rounded-2xl border border-edge bg-panel p-5 transition hover:border-faint" [style.box-shadow]="'inset 3px 0 0 ' + b.color">
            <div class="flex items-center gap-3">
              <p class="min-w-0 flex-1 truncate font-display text-[17px] font-semibold">{{ b.name }}</p>
              @if (b.openTasks) { <span class="rounded-full bg-raise px-2.5 py-0.5 text-[12px] tabular-nums text-mute">{{ b.openTasks }} abertas</span> }
            </div>
            <p class="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-mute">
              @if (projectOf(b.projectSlug); as p) { <app-project-avatar [project]="p" [size]="16" /><span [style.color]="p.color">{{ p.name }}</span> }
              @else { quadro solto }
              @if (b.description) { · <span class="truncate">{{ b.description }}</span> }
            </p>
            <!-- o fluxo: colunas e quem cuida -->
            <p class="mt-3 flex flex-wrap items-center gap-1 text-[12px]">
              @for (c of b.columns; track c.key; let last = $last) {
                <span class="flex items-center gap-1 rounded-md border px-1.5 py-0.5" [class]="c.agentId ? 'border-frost/40 bg-frost/10 text-frost' : 'border-edge text-mute'"
                      [style.border-color]="c.color" [title]="c.agentId ? agentName(c.agentId) + ' cuida desta etapa' : 'Sem agente'">
                  @if (agentOf(c.agentId); as a) { <app-project-avatar [project]="a" [size]="14" /> }
                  {{ c.label }}</span>
                @if (!last) { <span class="text-faint">→</span> }
              }
            </p>
          </a>
        } @empty {
          <p class="rounded-2xl border border-dashed border-edge px-6 py-8 text-center text-mute lg:col-span-2">
            Nenhum quadro ainda. Crie um para montar um fluxo com agentes (ex.: pesquisa → roteiro → arte → sua revisão).</p>
        }
      </div>
    </div>
  `,
})
export class BoardsPage {
  protected readonly boards = inject(BoardService);
  private readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  private readonly scope = inject(ScopeService);
  protected readonly shownBoards = computed(() => this.boards.boards().filter(b => this.scope.matches(b.projectSlug)));
  protected readonly templates = BOARD_TEMPLATES;
  protected readonly creating = signal(false);
  protected readonly name = signal('');
  protected readonly project = signal('');
  protected readonly template = signal(BOARD_TEMPLATES[0].id);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly agentOf = (id: number | null) => (id ? this.agents.byId().get(id) ?? null : null);
  protected readonly agentName = (id: number | null) => (id ? this.agents.byId().get(id)?.name ?? 'agente' : '');
  protected readonly projectOf = (slug: string | null) => (slug ? this.projects.bySlug().get(slug) ?? null : null);

  constructor() {
    // ?novo=<projeto>: "+ Quadro" vindo do backlog de um projeto
    effect(() => {
      const slug = this.query()?.get('novo');
      if (!slug) return;
      untracked(() => {
        this.project.set(slug);
        this.name.set(`${this.projects.bySlug().get(slug)?.name ?? slug} · `);
        this.creating.set(true);
      });
    });
  }

  protected async create(): Promise<void> {
    const t = BOARD_TEMPLATES.find(x => x.id === this.template())!;
    this.busy.set(true);
    this.error.set(null);
    try {
      const b = await this.boards.create(this.name().trim(), this.project() || null, t.columns);
      this.router.navigate(['/quadros', b.id]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
