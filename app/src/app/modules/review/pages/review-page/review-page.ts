import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ChatService } from '../../../../shared/services/chat/chat.service';
import { Delivery, DeliveriesService } from '../../../../shared/services/deliveries/deliveries.service';
import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { ScopeService, markProjects } from '../../../../shared/services/scope/scope.service';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { Task, TasksService } from '../../../../shared/services/tasks/tasks.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { MarkdownPipe } from '../../../../shared/ui/markdown';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';

/** Um item da revisão: a entrega de um agente (com a nota) ou uma tarefa em Revisão que não tem nota. */
type Item = { key: string; kind: 'delivery'; d: Delivery; task: Task | null } | { key: string; kind: 'task'; task: Task };

/**
 * Revisão: tudo o que espera o seu olhar num lugar só. Cada entrega mostra primeiro como testar, depois o que mudou, por
 * quê e os riscos; você aprova (a tarefa vai para Feito), pede ajuste (o mesmo agente continua, na mesma sessão) ou
 * descarta. Atalhos: ↑/↓ ou J/K navegam, A aprova, R pede ajuste.
 */
@Component({
  selector: 'app-review-page',
  imports: [Icon, AgoPipe, MarkdownPipe, ProjectAvatar, RouterLink],
  host: { class: 'grid h-full min-h-0 grid-cols-[380px_minmax(0,1fr)]', '(document:keydown)': 'key($event)' },
  template: `
    <!-- lista -->
    <section class="flex min-h-0 flex-col border-r border-edge bg-panel" aria-labelledby="rv-title">
      <div class="px-5 pt-6 pb-3">
        <h1 id="rv-title" class="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight"><app-icon name="pr" [size]="22" class="text-frost" />Revisão</h1>
        <p class="mt-1 text-[13px] text-mute">{{ items().length ? items().length + (items().length === 1 ? ' entrega espera' : ' entregas esperam') + ' o seu olhar.' : 'Nada esperando revisão.' }}</p>
      </div>
      <ul class="min-h-0 flex-1 overflow-y-auto px-2 pb-4" role="listbox" aria-label="O que espera revisão">
        @for (it of visible(); track it.key) {
          <li role="option" [attr.aria-selected]="current()?.key === it.key">
            <button type="button" (click)="select(it.key)" class="flex w-full gap-3 rounded-xl px-3 py-3 text-left hover:bg-raise/60" [class.bg-raise]="current()?.key === it.key">
              @if (project(slugOf(it)); as p) { <app-project-avatar class="mt-0.5" [project]="p" [size]="18" /> }
              @else { <span class="mt-1 size-[18px] shrink-0 rounded-md bg-edge"></span> }
              <span class="min-w-0 flex-1">
                <span class="line-clamp-2 leading-snug">{{ titleOf(it) }}</span>
                <span class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-mute">
                  @if (it.kind === 'delivery') {
                    <span>{{ it.d.agentName ?? 'agente' }} · {{ it.d.at | ago }}</span>
                    @if (it.d.failed) { <span class="text-no">não terminou</span> }
                    @if (!it.d.explained) { <span class="text-later">sem nota</span> }
                    @if (risky(it.d)) { <span class="text-later">riscos</span> }
                    @if (it.d.files) { <span>{{ it.d.files }} arq.</span> }
                  } @else {
                    <span>tarefa #{{ it.task.id }} · sem entrega de agente</span>
                  }
                </span>
              </span>
            </button>
          </li>
        } @empty {
          <li class="px-4 py-10 text-center text-[14px] text-mute">Tudo revisado. Quando um agente terminar algo, aparece aqui com como testar.</li>
        }
      </ul>
    </section>

    <!-- detalhe -->
    @if (current(); as it) {
      <section class="flex min-h-0 min-w-0 flex-col" aria-label="Revisão do item" [attr.data-run]="it.kind === 'delivery' ? it.d.runId : null" [attr.data-project]="slugOf(it)">
        <div class="min-h-0 flex-1 overflow-y-auto px-10 pt-7 pb-10">
          <p class="flex flex-wrap items-center gap-2 text-[13px]">
            @if (project(slugOf(it)); as p) {
              <span class="flex items-center gap-1.5 font-semibold" [style.color]="p.color"><app-project-avatar [project]="p" [size]="16" />{{ p.name }}</span>
            }
            @if (it.kind === 'delivery') { <span class="text-mute">· {{ it.d.agentName ?? 'agente' }} · {{ it.d.at | ago }}</span> }
            @if (taskOf(it); as t) { <button type="button" class="text-frost hover:underline" (click)="dialogs.editTask(t.id)">tarefa #{{ t.id }}</button> }
          </p>
          <h2 class="mt-2 font-display text-[24px] font-semibold leading-snug selectable">{{ titleOf(it) }}</h2>
          <!-- decidir: fica no topo, fixo ao rolar -->
          <div class="sticky top-0 z-10 -mx-10 mt-4 border-b border-edge bg-night/95 px-10 py-3 backdrop-blur">
            @if (adjusting()) {
              <textarea id="rv-adjust" class="field mb-2 h-24 w-full resize-y text-[14px]" placeholder="O que ajustar. Vai para o mesmo agente, na mesma sessão e pasta da entrega (Ctrl+Enter manda)."
                        aria-label="Ajuste pedido" [value]="note()" (input)="note.set($any($event.target).value)" (keydown.control.enter)="adjust(it)" (keydown.escape)="adjusting.set(false)"></textarea>
            }
            <div class="flex flex-wrap items-center gap-2">
              @if (it.kind === 'delivery') {
                @if (adjusting()) {
                  <button type="button" class="btn btn-primary" [disabled]="!note().trim() || busy()" (click)="adjust(it)"><app-icon name="send" [size]="14" />Mandar para o agente</button>
                  <button type="button" class="btn btn-ghost" (click)="adjusting.set(false)">Cancelar</button>
                } @else {
                  <button type="button" class="btn !border-yes !bg-yes !text-night" (click)="approve(it)" title="Revisado: a tarefa vai para Feito (o merge do PR, se faltar, você faz no GitHub)">
                    <app-icon name="check" [size]="15" />Aprovar <kbd class="ml-1 text-xs opacity-70">A</kbd></button>
                  <button type="button" class="btn" (click)="openAdjust()">Pedir ajuste <kbd class="ml-1 text-xs opacity-60">R</kbd></button>
                  <button type="button" class="btn btn-ghost text-mute" (click)="discard(it)">Descartar</button>
                }
              } @else {
                <button type="button" class="btn !border-yes !bg-yes !text-night" (click)="approve(it)"><app-icon name="check" [size]="15" />Marcar como feito <kbd class="ml-1 text-xs opacity-70">A</kbd></button>
                <button type="button" class="btn" (click)="dialogs.editTask(it.task.id)">Abrir a tarefa</button>
              }
              <span class="flex-1"></span>
              @if (prOf(it); as pr) { <button type="button" class="btn btn-sm btn-ghost" (click)="projects.openExternal(pr)"><app-icon name="pr" [size]="14" />PR</button> }
              @if (it.kind === 'delivery' && run(it.d.runId)?.worktreePath; as wt) { <button type="button" class="btn btn-sm btn-ghost" (click)="projects.openInVsCode(wt)"><app-icon name="code" [size]="14" />VS Code</button> }
              @if (it.kind === 'delivery') { <a class="btn btn-sm btn-ghost" routerLink="/execucoes" [queryParams]="{ run: it.d.runId }"><app-icon name="activity" [size]="14" />Execução</a> }
            </div>
            @if (error()) { <p role="alert" class="mt-2 text-[13px] text-no">{{ error() }}</p> }
            <p class="mt-1.5 text-[11.5px] text-faint">{{ adjusting() ? 'Esc cancela · Ctrl+Enter manda' : 'A aprova · R pede ajuste · ↑↓ navega' }}</p>
          </div>

          @if (it.kind === 'delivery') {
            @let d = it.d;
            @if (d.howToTest) {
              <section class="mt-6 rounded-2xl border border-frost/40 bg-frost/5 px-5 py-4" aria-labelledby="rv-test">
                <h3 id="rv-test" class="flex items-center gap-2 font-semibold text-frost"><app-icon name="check" [size]="16" />Como testar</h3>
                <div class="md mt-2 text-[14.5px] selectable" [innerHTML]="d.howToTest | markdown"></div>
              </section>
            } @else {
              <p class="mt-6 rounded-2xl border border-dashed border-edge px-5 py-3 text-[13.5px] text-mute">O agente não disse como testar. Peça no ajuste ("diga como eu testo em 1 minuto"), se precisar.</p>
            }
            @if (d.risks) {
              <section class="mt-4 rounded-2xl border border-later/40 bg-later/5 px-5 py-3">
                <h3 class="font-semibold text-later">Riscos e o que ficou de fora</h3>
                <div class="md mt-1 text-[14px] selectable" [innerHTML]="d.risks | markdown"></div>
              </section>
            }
            <section class="mt-6">
              <h3 class="text-[13px] font-semibold uppercase tracking-wide text-faint">O que mudou</h3>
              <div class="md mt-1.5 text-[14.5px] selectable" [innerHTML]="d.what | markdown"></div>
            </section>
            @if (d.why) {
              <section class="mt-5">
                <h3 class="text-[13px] font-semibold uppercase tracking-wide text-faint">Por quê</h3>
                <div class="md mt-1.5 text-[14.5px] selectable" [innerHTML]="d.why | markdown"></div>
              </section>
            }
            @if (d.diffStat) {
              <section class="mt-5">
                <h3 class="text-[13px] font-semibold uppercase tracking-wide text-faint">Arquivos ({{ d.files }} · <span class="text-yes">+{{ d.additions }}</span> <span class="text-later">−{{ d.deletions }}</span>)</h3>
                <pre class="mt-1.5 max-h-64 overflow-auto rounded-xl bg-night p-3 font-mono text-[11.5px] leading-relaxed text-mute selectable">{{ d.diffStat }}</pre>
              </section>
            }
            @if (d.reviewNote) { <p class="mt-5 text-[13px] text-mute">Último ajuste pedido: <span class="text-text">{{ d.reviewNote }}</span></p> }
          } @else {
            @let t = it.task;
            <p class="mt-6 rounded-2xl border border-dashed border-edge px-5 py-3 text-[13.5px] text-mute">Esta tarefa está em Revisão sem uma entrega de agente (foi movida à mão ou é anterior às notas de entrega).</p>
            @if (t.body) { <div class="md mt-4 text-[14.5px] selectable" [innerHTML]="t.body | markdown"></div> }
          }
        </div>

      </section>
    } @else {
      <section class="grid flex-1 place-items-center text-mute">Escolha um item na lista.</section>
    }
  `,
})
export class ReviewPage {
  protected readonly deliveries = inject(DeliveriesService);
  protected readonly projects = inject(ProjectsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly tasks = inject(TasksService);
  private readonly runs = inject(RunsService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);

  private readonly scope = inject(ScopeService);
  private readonly marks = markProjects(() => this.items().map(it => this.slugOf(it)), 'bg-frost text-night', 'para revisar');
  private readonly selected = signal<string | null>(null);
  protected readonly adjusting = signal(false);
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** entregas (fila + a nota mais recente de cada tarefa em Revisão) e as tarefas em Revisão sem entrega */
  protected readonly items = computed<Item[]>(() => {
    const byTask = new Map(this.tasks.tasks().map(t => [t.id, t]));
    const list: Item[] = this.deliveries.board().map(d => ({ key: `d${d.id}`, kind: 'delivery' as const, d, task: d.taskId ? byTask.get(d.taskId) ?? null : null }));
    const covered = new Set(this.deliveries.board().map(d => d.taskId));
    for (const t of this.tasks.tasks()) if (t.column === 'review' && !covered.has(t.id)) list.push({ key: `t${t.id}`, kind: 'task', task: t });
    return list;
  });
  protected readonly visible = computed(() => this.items().filter(it => this.scope.matches(this.slugOf(it))));
  protected readonly current = computed(() => this.visible().find(it => it.key === this.selected()) ?? this.visible()[0] ?? null);

  constructor() {
    // trocou de item: fecha o ajuste aberto
    effect(() => { this.current(); this.adjusting.set(false); this.note.set(''); this.error.set(null); });
  }

  /** o agente apontou risco de verdade ("Nenhum risco…" não conta) */
  protected risky(d: Delivery): boolean { return !!d.risks && !/^\s*(nenhum|nada|sem risco)/i.test(d.risks); }
  protected slugOf(it: Item): string | null { return it.kind === 'delivery' ? it.d.projectSlug : it.task.projectSlug; }
  protected titleOf(it: Item): string { return it.kind === 'delivery' ? (it.task?.title ?? it.d.title) : it.task.title; }
  protected taskOf(it: Item): Task | null { return it.kind === 'delivery' ? it.task : it.task; }
  protected prOf(it: Item): string | null { return it.kind === 'delivery' ? it.d.prUrl ?? it.task?.prUrl ?? null : it.task.prUrl; }
  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }
  protected run(id: number) { return this.runs.runs().find(r => r.id === id) ?? null; }
  protected select(key: string): void { this.selected.set(key); }

  /** depois de decidir, abre o próximo da lista */
  private advance(it: Item): void {
    const list = this.visible();
    const i = list.findIndex(x => x.key === it.key);
    this.selected.set((list[i + 1] ?? list[i - 1])?.key ?? null);
  }

  protected approve(it: Item): void {
    this.advance(it);
    if (it.kind === 'delivery') this.deliveries.accept(it.d);
    else this.tasks.move(it.task.id, 'done', 0);
  }
  protected discard(it: Item): void {
    if (it.kind !== 'delivery') return;
    this.advance(it);
    this.deliveries.discard(it.d);
  }
  protected openAdjust(): void {
    this.adjusting.set(true);
    queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('#rv-adjust')?.focus());
  }
  protected async adjust(it: Item): Promise<void> {
    const text = this.note().trim();
    if (it.kind !== 'delivery' || !text || this.busy()) return;
    this.busy.set(true);
    try {
      this.advance(it);
      const chatId = await this.deliveries.adjust(it.d, text);
      this.chat.openInPanel(chatId);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected key(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.querySelector('dialog[open]')) return;
    const it = this.current();
    const list = this.visible();
    const i = it ? list.findIndex(x => x.key === it.key) : -1;
    const k = e.key.toLowerCase();
    if (k === 'arrowdown' || k === 'j') { e.preventDefault(); if (list[i + 1]) this.selected.set(list[i + 1].key); }
    else if (k === 'arrowup' || k === 'k') { e.preventDefault(); if (list[i - 1]) this.selected.set(list[i - 1].key); }
    else if (k === 'a' && it) { e.preventDefault(); this.approve(it); }
    else if (k === 'r' && it?.kind === 'delivery') { e.preventDefault(); this.openAdjust(); }
  }
}
