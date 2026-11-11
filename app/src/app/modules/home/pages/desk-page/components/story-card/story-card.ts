import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Delivery, DeliveriesService } from '../../../../../../shared/services/deliveries/deliveries.service';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { Task } from '../../../../../../shared/services/tasks/tasks.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { MarkdownPipe } from '../../../../../../shared/ui/markdown';

/**
 * Uma história pronta para o Gustavo usar: o que muda para quem usa, o vídeo do agente fazendo o fluxo, o roteiro de
 * usuário e a resposta ali mesmo (Funciona / Não funcionou + o que viu).
 */
@Component({
  selector: 'app-story-card',
  imports: [AgoPipe, Icon, MarkdownPipe, RouterLink],
  template: `
    @let d = delivery();
    <article class="overflow-hidden rounded-3xl border border-edge bg-panel" [style.box-shadow]="'inset 4px 0 0 ' + (project()?.color ?? 'var(--color-frost)')"
             [attr.aria-label]="'História: ' + title()">
      <div class="grid gap-6 px-7 pt-6 pb-5" [class]="d.video ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]' : ''">
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 text-[12.5px]">
            @if (project(); as p) { <span class="font-semibold" [style.color]="p.color">{{ p.name }}</span> }
            <span class="text-faint">· {{ task()?.subtasks ?? 0 }} partes prontas · testada por {{ d.agentName ?? 'agente' }} {{ d.at | ago }}</span>
          </p>
          <h3 class="mt-1.5 font-display text-[22px] font-semibold leading-snug">{{ title() }}</h3>
          @if (d.what) { <div class="md mt-2 text-[14.5px] leading-relaxed text-mute" [innerHTML]="d.what | markdown"></div> }

          @if (d.howToTest) {
            <section class="mt-4 rounded-2xl border border-frost/30 bg-frost/[0.04] px-5 py-4" aria-label="Roteiro de usuário">
              <h4 class="flex items-center gap-2 text-[13px] font-semibold text-frost"><app-icon name="play" [size]="14" />Use assim</h4>
              <div class="md mt-2 text-[14px] leading-relaxed selectable" [class.line-clamp-[9]]="!full()" [innerHTML]="d.howToTest | markdown"></div>
              @if (long()) { <button type="button" class="mt-1 text-[12.5px] text-frost hover:underline" (click)="full.set(!full())">{{ full() ? 'mostrar menos' : 'ver o roteiro inteiro' }}</button> }
            </section>
          }
          @if (risky()) {
            <p class="mt-3 flex gap-2 text-[13px] leading-snug text-later"><app-icon name="flag" [size]="14" class="mt-0.5 shrink-0" /><span>{{ d.risks }}</span></p>
          }
        </div>
        @if (d.video) {
          <video class="w-full self-start rounded-2xl border border-edge bg-black" [src]="d.video" controls preload="metadata" aria-label="O agente usando o fluxo"></video>
        }
      </div>

      <footer class="border-t border-edge bg-night/30 px-7 py-4">
        @if (saying()) {
          <textarea class="field mb-3 h-24 w-full resize-y text-[14px]" placeholder="O que você fez e o que viu (ou o que esperava ver). O dono conserta e a história volta para você."
                    aria-label="O que não funcionou" [value]="note()" (input)="note.set($any($event.target).value)" (keydown.control.enter)="returnIt()" (keydown.escape)="saying.set(false)"></textarea>
        }
        <div class="flex flex-wrap items-center gap-2">
          @if (saying()) {
            <button type="button" class="btn btn-primary" [disabled]="!note().trim() || busy()" (click)="returnIt()"><app-icon name="send" [size]="14" />Devolver ao dono</button>
            <button type="button" class="btn btn-ghost" (click)="saying.set(false)">Cancelar</button>
          } @else {
            <button type="button" class="btn !border-yes !bg-yes px-5 !text-night" (click)="works()"><app-icon name="check" [size]="15" />Funciona</button>
            <button type="button" class="btn" (click)="saying.set(true)">Não funcionou</button>
          }
          <span class="flex-1"></span>
          <a routerLink="/revisao" class="text-[12.5px] text-faint hover:text-text">detalhes técnicos</a>
        </div>
        @if (error()) { <p role="alert" class="mt-2 text-[13px] text-no">{{ error() }}</p> }
      </footer>
    </article>`,
})
export class StoryCard {
  private readonly deliveries = inject(DeliveriesService);
  private readonly projects = inject(ProjectsService);

  readonly delivery = input.required<Delivery>();
  readonly task = input<Task | null>(null);

  protected readonly project = computed(() => this.projects.bySlug().get(this.delivery().projectSlug ?? '') ?? null);
  protected readonly title = computed(() => this.task()?.title ?? this.delivery().title);
  protected readonly long = computed(() => (this.delivery().howToTest ?? '').split('\n').length > 9);
  protected readonly risky = computed(() => { const r = this.delivery().risks; return !!r && !/^\s*(nenhum|nada|sem risco)/i.test(r); });
  protected readonly full = signal(false);
  protected readonly saying = signal(false);
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected works(): void { this.deliveries.accept(this.delivery()); }

  protected async returnIt(): Promise<void> {
    if (!this.note().trim()) return;
    this.busy.set(true);
    try { await this.deliveries.adjust(this.delivery(), this.note().trim()); }
    catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }
}
