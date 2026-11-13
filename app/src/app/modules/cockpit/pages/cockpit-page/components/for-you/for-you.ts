import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChatService } from '../../../../../../shared/services/chat/chat.service';
import { Delivery, DeliveriesService } from '../../../../../../shared/services/deliveries/deliveries.service';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { Proposal } from '../../../../../../shared/services/proposals/proposals.model';
import { ProposalsService } from '../../../../../../shared/services/proposals/proposals.service';
import { QuickCommandsService } from '../../../../../../shared/services/quick-commands/quick-commands.service';
import { RunsService } from '../../../../../../shared/services/runs/runs.service';
import { Task, TasksService } from '../../../../../../shared/services/tasks/tasks.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../../../shared/ui/project-avatar';
import { CockpitService } from '../../../../services/cockpit/cockpit.service';
import { StoryCard } from '../story-card/story-card';

/**
 * "Para você": só o que é do Gustavo, numa faixa. Quebrou (vermelho), só você destrava, histórias para usar, pedidos de
 * 1:1 e decisões. Cada cartão resolve ali mesmo (ou abre o que precisa).
 */
@Component({
  selector: 'app-for-you',
  imports: [AgoPipe, Icon, ProjectAvatar, RouterLink, StoryCard],
  template: `
    <!-- quebrou de verdade: acima de tudo, impossível de não ver -->
    @for (a of alerts(); track a.id) {
      <div role="alert" class="ck-alarm mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-no/60 bg-no/[0.08] px-5 py-3.5">
        <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-no/20 text-no"><app-icon name="flag" [size]="17" /></span>
        <div class="min-w-[240px] flex-1">
          <p class="text-[12px] font-bold uppercase tracking-wider text-no">Quebrou · {{ a.product }} · {{ a.at | ago }}</p>
          <p class="leading-snug">{{ a.summary }}</p>
        </div>
        <a [routerLink]="['/produtos', a.slug]" class="btn btn-sm">Ver com o dono</a>
        <button type="button" class="btn btn-sm btn-ghost" (click)="cockpit.resolveAlert(a.id)">Resolvido</button>
      </div>
    }
    <!-- um dono pediu 1:1: faixa própria (no meio dos cartões passava batido) -->
    @for (p of oneOnOnes(); track p.slug) {
      <a [routerLink]="['/produtos', p.slug]" class="ck-ping mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[#B48CFF]/60 bg-[#B48CFF]/[0.09] px-5 py-3.5 transition hover:border-[#B48CFF]" [style.--c]="'#B48CFF'">
        @if (p.face) { <app-project-avatar [project]="$any(p.face)" [size]="38" /> }
        @else { <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-[#B48CFF]/20 text-[#C6A6FF]"><app-icon name="comments" [size]="17" /></span> }
        <div class="min-w-[240px] flex-1">
          <p class="text-[12px] font-bold uppercase tracking-wider text-[#C6A6FF]">{{ p.owner }} pediu um 1:1 · {{ p.name }}@if (p.at) { · {{ p.at | ago }} }</p>
          <p class="leading-snug">{{ p.why }}</p>
        </div>
        <span class="btn btn-sm !border-[#B48CFF] !bg-[#B48CFF] !text-night"><app-icon name="comments" [size]="14" />Abrir o 1:1</span>
      </a>
    }
    @if (count() - alerts().length - oneOnOnes().length) {
      <section aria-labelledby="pv" class="ck-rise">
        <div class="flex items-baseline gap-3">
          <h2 id="pv" class="font-display text-[20px] font-semibold">Para você</h2>
          @let n = count() - alerts().length - oneOnOnes().length;
          <span class="text-[13px] text-faint">{{ n }} {{ n === 1 ? 'coisa' : 'coisas' }} · o resto está com os donos</span>
        </div>
        <div class="-mx-1 mt-3 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-color:var(--color-edge)_transparent] [scrollbar-width:thin]">
          @for (r of runs.waiting(); track r.id) {
            <article class="flex w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-later/40 bg-later/[0.06] p-4">
              <p class="text-[11.5px] font-semibold uppercase tracking-wider text-later">Só você destrava · {{ projectName(r.projectSlug) }}</p>
              <p class="mt-1 line-clamp-2 text-[13.5px] leading-snug">{{ r.waiting!.reason }}</p>
              <p class="mt-1 line-clamp-2 text-[12px] text-mute">{{ r.waiting!.fix }}</p>
              <span class="flex-1"></span>
              <div class="mt-3 flex gap-2">
                @if (r.waiting!.command) { <button type="button" class="btn btn-sm" (click)="runFix(r.waiting!.command!, r.projectSlug)"><app-icon name="play" [size]="12" />Rodar</button> }
                <button type="button" class="btn btn-sm btn-primary" (click)="resume(r.id)">Já resolvi</button>
              </div>
            </article>
          }
          @for (s of stories(); track s.d.id) {
            <button type="button" (click)="openStory(s.d, s.task)" class="flex w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-frost/40 bg-frost/[0.06] p-4 text-left transition hover:border-frost">
              <p class="text-[11.5px] font-semibold uppercase tracking-wider text-frost">Use e diga se funciona · {{ projectName(s.d.projectSlug) }}</p>
              <p class="mt-1 line-clamp-2 font-semibold leading-snug">{{ s.task?.title ?? s.d.title }}</p>
              <p class="mt-1 line-clamp-2 text-[12.5px] text-mute">{{ s.d.what }}</p>
              <span class="flex-1"></span>
              <span class="mt-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-frost"><app-icon name="play" [size]="13" />{{ s.d.video ? 'Ver o vídeo e usar' : 'Abrir o roteiro' }}</span>
            </button>
          }
          @for (p of decisions(); track p.id) {
            <article class="flex w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-edge bg-panel p-4">
              <p class="text-[11.5px] font-semibold uppercase tracking-wider" [class]="p.source === 'rumo' ? 'text-frost' : 'text-later'">
                {{ p.source === 'rumo' ? 'Rumo novo' : 'Decida' }} · {{ projectName(p.projectSlug) }}</p>
              <p class="mt-1 line-clamp-2 font-semibold leading-snug">{{ p.title }}</p>
              @if (p.summary || p.nextAction) { <p class="mt-1 line-clamp-2 text-[12.5px] text-mute">{{ p.summary || p.nextAction }}</p> }
              <span class="flex-1"></span>
              <div class="mt-3 flex flex-wrap gap-1.5">
                @if (p.options.length) {
                  @for (o of p.options.slice(0, 2); track $index) {
                    <button type="button" class="max-w-full truncate rounded-full border border-yes/50 px-3 py-1 text-[12px] font-semibold text-yes hover:bg-yes/10" (click)="choose(p, o)">{{ o }}</button>
                  }
                } @else {
                  <button type="button" class="rounded-full bg-yes px-3 py-1 text-[12px] font-semibold text-night" (click)="proposals.decide(p, 'approve')">Aprovar</button>
                  <button type="button" class="rounded-full border border-edge px-3 py-1 text-[12px] font-semibold text-no" (click)="proposals.decide(p, 'reject')">Não</button>
                }
                <a routerLink="/triagem" class="px-1.5 py-1 text-[12px] text-faint hover:text-text">ler</a>
              </div>
            </article>
          }
        </div>
      </section>
    }

    <dialog #dlg (close)="story.set(null)" class="m-auto w-[min(1080px,94vw)] rounded-[28px] border-0 bg-transparent p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm" aria-label="História">
      @if (story(); as s) {
        <div class="relative">
          <button type="button" class="absolute top-4 right-4 z-10 grid size-9 place-items-center rounded-full bg-night/80 text-mute hover:text-text" (click)="close()" aria-label="Fechar"><app-icon name="close" [size]="17" /></button>
          <app-story-card [delivery]="s.d" [task]="s.task" />
        </div>
      }
    </dialog>`,
})
export class ForYou {
  protected readonly cockpit = inject(CockpitService);
  protected readonly runs = inject(RunsService);
  protected readonly proposals = inject(ProposalsService);
  private readonly deliveries = inject(DeliveriesService);
  private readonly tasks = inject(TasksService);
  private readonly projects = inject(ProjectsService);
  private readonly chat = inject(ChatService);
  private readonly quick = inject(QuickCommandsService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  private readonly products = computed(() => this.cockpit.companies().flatMap(c => c.products));
  protected readonly alerts = computed(() => this.products().flatMap(p => p.alerts.map(a => ({ ...a, slug: p.slug, product: p.name }))));
  protected readonly oneOnOnes = computed(() => this.products().filter(p => p.oneOnOne).map(p => ({ slug: p.slug, name: p.name, owner: p.owner?.name ?? 'O dono', face: p.owner, why: p.oneOnOne!.why, at: p.oneOnOne!.at })));
  private readonly byTask = computed(() => new Map(this.tasks.tasks().map(t => [t.id, t])));
  protected readonly stories = computed(() => this.deliveries.board()
    .filter(d => d.status === 'review' && d.taskId && (this.byTask().get(d.taskId)?.subtasks ?? 0) > 0)
    .map(d => ({ d, task: this.byTask().get(d.taskId!) ?? null })));
  protected readonly decisions = computed(() => [...this.proposals.inbox()].sort((a, b) => Number(b.source === 'rumo') - Number(a.source === 'rumo')));
  readonly count = computed(() => this.alerts().length + this.runs.waiting().length + this.stories().length + this.oneOnOnes().length + this.decisions().length);
  protected readonly story = signal<{ d: Delivery; task: Task | null } | null>(null);

  protected projectName(slug: string | null): string { return (slug && this.projects.bySlug().get(slug)?.name) || 'geral'; }
  protected choose(p: Proposal, o: string): void { this.proposals.decide(p, 'approve', `Escolheu: ${o}`); }
  protected openStory(d: Delivery, task: Task | null): void { this.story.set({ d, task }); this.dlg().nativeElement.showModal(); }
  protected close(): void { this.dlg().nativeElement.close(); }
  protected runFix(command: string, slug: string | null): void { this.quick.inTerminal(command, slug, 'shell', true).catch(() => {}); }
  protected async resume(runId: number): Promise<void> { const c = await this.runs.resume(runId).catch(() => null); if (c) this.chat.openInPanel(c); }
}
