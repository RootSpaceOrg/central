import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DIRECTION_TEMPLATE, Direction, DirectionService } from '../../../../../../shared/services/direction/direction.service';
import { IdeasService } from '../../../../../../shared/services/ideas/ideas.service';
import { Project } from '../../../../../../shared/services/projects/projects.model';
import { TasksService } from '../../../../../../shared/services/tasks/tasks.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { MarkdownPipe } from '../../../../../../shared/ui/markdown';

/**
 * O rumo do projeto (para onde vamos) com histórico de quem mudou, o pedido ao gestor do projeto e o funil das ideias.
 * É a parte de "gestor" da página: você aponta o caminho; o gestor transforma em backlog quando você pede.
 */
@Component({
  selector: 'app-direction-panel',
  imports: [Icon, AgoPipe, MarkdownPipe, RouterLink],
  host: { class: 'block space-y-6' },
  template: `
    @let d = direction();
    <section class="rounded-3xl border border-edge bg-panel p-6" aria-labelledby="rumo-title">
      <div class="flex items-start gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-xl text-night" [style.background]="project().color"><app-icon name="flag" [size]="18" /></span>
        <div class="min-w-0 flex-1">
          <h2 id="rumo-title" class="font-display text-xl font-semibold">Rumo</h2>
          <p class="text-[12.5px] text-mute">
            @if (d) { Atualizado {{ d.at | ago }} por {{ d.author === 'gustavo' ? 'você' : 'um agente' }}@if (d.note) {: {{ d.note }}}. }
            @else { Para onde o projeto vai. Você escreve; os agentes seguem e podem propor ajustes. }
          </p>
        </div>
        @if (!editing()) {
          <button type="button" class="btn btn-sm" (click)="edit()"><app-icon name="edit" [size]="14" />{{ d ? 'Editar' : 'Escrever rumo' }}</button>
        }
      </div>

      @if (editing()) {
        <textarea class="field mt-4 min-h-56 resize-y font-mono text-[13px] leading-relaxed" aria-label="Rumo do projeto"
                  [value]="draft()" (input)="draft.set($any($event.target).value)"></textarea>
        <div class="mt-2 flex items-center gap-2">
          <input class="field flex-1 !py-1.5 text-[13px]" placeholder="O que mudou e por quê (opcional, fica no histórico)" aria-label="Motivo da mudança"
                 [value]="note()" (input)="note.set($any($event.target).value)" />
          <button type="button" class="btn btn-sm btn-ghost" (click)="editing.set(false)">Cancelar</button>
          <button type="button" class="btn btn-sm btn-primary" (click)="save()" [disabled]="!draft().trim() || saving()">Salvar rumo</button>
        </div>
        @if (error()) { <p role="alert" class="mt-2 text-[13px] text-no">{{ error() }}</p> }
      } @else if (d) {
        <div class="md mt-4 selectable" [innerHTML]="d.text | markdown"></div>
      } @else {
        <p class="mt-4 rounded-2xl border border-dashed border-edge px-5 py-6 text-center text-mute">
          Sem rumo ainda. Mesmo genérico ajuda: "estabilizar o que existe", "fechar a fase 1 de X", "só suporte, sem features".</p>
      }

      @if (d && !editing()) {
        <button type="button" class="mt-4 text-[12.5px] text-faint hover:text-mute" (click)="toggleHistory()">
          {{ showHistory() ? 'Esconder histórico' : 'Ver histórico' }}</button>
        @if (showHistory()) {
          <ol class="mt-2 space-y-2 border-l-2 border-edge pl-4">
            @for (h of history(); track h.id) {
              <li class="text-[12.5px]">
                <p class="text-mute">{{ h.at | ago }} · {{ h.author === 'gustavo' ? 'você' : 'agente' }}@if (h.note) { · {{ h.note }} }</p>
                <details><summary class="cursor-pointer text-faint hover:text-mute">ver versão</summary>
                  <pre class="mt-1 whitespace-pre-wrap font-mono text-[11.5px] text-mute">{{ h.text }}</pre></details>
              </li>
            }
          </ol>
        }
      }
    </section>

    <section class="rounded-3xl border border-edge bg-panel p-6" aria-labelledby="gestor-title">
      <h2 id="gestor-title" class="font-display text-lg font-semibold">Pedir ao gestor do projeto</h2>
      <p class="text-[13px] text-mute">Ele lê o rumo, as ideias aprovadas, o backlog e o código, quebra as ideias em tarefas e reordena tudo pelo rumo. Não executa nada.</p>
      <div class="mt-3 flex gap-2">
        <input class="field flex-1" placeholder="Opcional: &quot;foque no onboarding&quot;, &quot;prepare a semana&quot;, &quot;limpe o backlog&quot;…" aria-label="Pedido ao gestor"
               [value]="request()" (input)="request.set($any($event.target).value)" (keydown.enter)="plan()" />
        <button type="button" class="btn btn-primary" (click)="plan()" [disabled]="direction_.planning()[project().slug]">
          <app-icon name="kanban" [size]="16" />Planejar backlog</button>
      </div>
      @if (runId(); as id) { <p class="mt-2 text-[13px] text-yes">Gestor trabalhando. <a routerLink="/execucoes" [queryParams]="{ run: id }" class="underline">Acompanhar</a></p> }
      @if (planError()) { <p role="alert" class="mt-2 text-[13px] text-no">{{ planError() }}</p> }
    </section>

    <section aria-labelledby="funil-title">
      <div class="mb-3 flex items-baseline justify-between">
        <h2 id="funil-title" class="font-display text-lg font-semibold">Ideias do projeto</h2>
        <a routerLink="/triagem" class="text-[13px] text-frost hover:underline">Triagem</a>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        @for (c of funnel(); track c.label) {
          <div class="rounded-2xl border border-edge bg-panel p-4">
            <p class="font-display text-2xl font-semibold tabular-nums" [class]="c.tone">{{ c.n }}</p>
            <p class="text-[12.5px] text-mute">{{ c.label }}</p>
          </div>
        }
      </div>
      @for (i of active(); track i.id) {
        <div class="mt-2 flex items-center gap-3 rounded-2xl border border-edge bg-panel px-4 py-2.5">
          <span class="size-2 shrink-0 rounded-full" [class]="i.status === 'doing' ? 'bg-later' : 'bg-frost'"></span>
          <span class="min-w-0 flex-1 truncate text-[13.5px]">{{ i.title }}</span>
          @if (i.tasks) {
            <span class="flex w-28 items-center gap-1.5 text-[11.5px] text-faint">
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-night"><span class="block h-full rounded-full bg-yes" [style.width.%]="i.tasksDone / i.tasks * 100"></span></span>
              {{ i.tasksDone }}/{{ i.tasks }}</span>
          } @else {
            <span class="text-[11.5px] text-frost">esperando o gestor</span>
          }
        </div>
      }
    </section>`,
})
export class DirectionPanel {
  protected readonly direction_ = inject(DirectionService);
  private readonly ideas = inject(IdeasService);
  private readonly tasks = inject(TasksService);

  readonly project = input.required<Project>();

  protected readonly direction = computed(() => this.direction_.bySlug()[this.project().slug] ?? null);
  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly note = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showHistory = signal(false);
  protected readonly history = signal<Direction[]>([]);
  protected readonly request = signal('');
  protected readonly runId = signal<number | null>(null);
  protected readonly planError = signal<string | null>(null);

  protected readonly funnel = computed(() => {
    const list = this.ideas.of(this.project().slug);
    const open = this.tasks.tasks().filter(t => t.projectSlug === this.project().slug && t.column !== 'done');
    return [
      { label: 'para triar', n: list.filter(i => i.status === 'new').length, tone: 'text-later' },
      { label: 'aprovadas sem tarefa', n: list.filter(i => i.status === 'approved' && !i.tasks).length, tone: 'text-frost' },
      { label: 'em andamento', n: list.filter(i => i.status === 'doing').length, tone: '' },
      { label: 'tarefas abertas', n: open.length, tone: 'text-mute' },
    ];
  });
  /** aprovadas e em andamento, as que estão no caminho agora */
  protected readonly active = computed(() => this.ideas.of(this.project().slug).filter(i => i.status === 'approved' || i.status === 'doing').slice(0, 8));

  constructor() {
    effect(() => { const slug = this.project().slug; untracked(() => { this.direction_.load(slug); this.editing.set(false); this.runId.set(null); }); });
  }

  protected edit(): void {
    this.draft.set(this.direction()?.text ?? DIRECTION_TEMPLATE);
    this.note.set('');
    this.error.set(null);
    this.editing.set(true);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      await this.direction_.save(this.project().slug, this.draft(), this.note() || null);
      this.editing.set(false);
      if (this.showHistory()) this.history.set(await this.direction_.history(this.project().slug));
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleHistory(): Promise<void> {
    this.showHistory.update(v => !v);
    if (this.showHistory()) this.history.set(await this.direction_.history(this.project().slug));
  }

  protected async plan(): Promise<void> {
    this.planError.set(null);
    try {
      this.runId.set(await this.direction_.plan(this.project().slug, this.request().trim() || null));
      this.request.set('');
    } catch (e) {
      this.planError.set((e as Error).message);
    }
  }
}
