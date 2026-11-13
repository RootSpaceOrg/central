import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';

import { RunsService } from '../../../../shared/services/runs/runs.service';
import { CockpitService, Instrument } from '../../../cockpit/services/cockpit/cockpit.service';
import { InstrumentCard } from '../../../cockpit/pages/cockpit-page/components/instrument/instrument';
import { OfficePage } from '../../../office/pages/office-page/office-page';

/**
 * Modo apresentação: para deixar num monitor da mesa, em tela cheia (janela própria, F11). Os produtos rodando, como no
 * Cockpit, e o escritório com o time trabalhando. Só olhar: nada aqui é clicável. Tela larga deitada: lado a lado; em pé
 * (monitor girado) ou estreita: o andar em cima na largura toda e os produtos embaixo, em duas colunas. Os produtos que
 * não cabem rolam sozinhos, devagar.
 */
@Component({
  selector: 'app-presentation-page',
  imports: [InstrumentCard, OfficePage],
  host: { class: 'flex h-screen flex-col gap-4 overflow-hidden bg-night p-4 xl:p-6' },
  template: `
    <header class="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-2">
      <span class="flex items-center gap-3">
        <img src="logo.png" alt="" class="size-8 rounded-xl" />
        <span class="font-display text-[22px] font-bold tracking-tight">Central</span>
      </span>
      <span class="font-display text-[clamp(22px,2.6vw,40px)] font-bold tabular-nums leading-none">{{ clock() }}</span>
      <span class="text-[13px] text-mute first-letter:uppercase">{{ date() }}</span>
      <span class="flex-1"></span>
      <span class="flex items-center gap-2 text-[15px]">
        @if (working()) { <span class="pulse size-2.5 rounded-full bg-yes"></span> }
        <b class="font-display text-[22px] tabular-nums">{{ working() }}</b><span class="ml-0.5 text-mute">{{ working() === 1 ? 'agente trabalhando' : 'agentes trabalhando' }}</span></span>
      <span class="text-[15px]"><b class="font-display text-[22px] tabular-nums text-yes">{{ delivered() }}</b><span class="ml-1.5 text-mute">entregues na semana</span></span>
      <span class="hidden text-[11.5px] text-faint xl:inline">F11 tela cheia</span>
    </header>

    <div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 lg:landscape:grid-cols-[minmax(340px,30%)_minmax(0,1fr)] lg:landscape:grid-rows-1">
      <!-- produtos: os que têm gente trabalhando primeiro -->
      <section #scroller class="min-h-0 overflow-y-auto [scrollbar-width:none]" aria-label="Produtos">
        <div class="pointer-events-none grid items-start gap-3 sm:grid-cols-2 lg:landscape:grid-cols-1">
          @for (p of products(); track p.slug) { <app-instrument [product]="p" /> }
          @empty { <p class="py-10 text-center text-mute">Nenhum produto ativo.</p> }
        </div>
      </section>
      <!-- o andar -->
      <app-office-page class="order-first min-h-0 lg:landscape:order-none" [stage]="true" />
    </div>`,
})
export class PresentationPage {
  private readonly cockpit = inject(CockpitService);
  private readonly runs = inject(RunsService);

  private readonly now = signal(new Date());
  private readonly timer = setInterval(() => this.now.set(new Date()), 15_000);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  /** produtos que não cabem: desce devagar, para no fim uns segundos e volta ao topo */
  private wait = 0;
  private readonly roll = setInterval(() => {
    const el = this.scroller()?.nativeElement;
    if (!el || el.scrollHeight <= el.clientHeight + 4) return;
    if (this.wait > 0) { this.wait--; if (!this.wait && el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    el.scrollTop += 1;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) this.wait = 120; // ~5 s parado no fim
  }, 40);
  private readonly stop = inject(DestroyRef).onDestroy(() => { clearInterval(this.timer); clearInterval(this.roll); });
  protected readonly clock = computed(() => this.now().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  protected readonly date = computed(() => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(this.now()));

  protected readonly working = computed(() => this.runs.active().length);
  private readonly all = computed(() => this.cockpit.companies().flatMap(c => c.products));
  protected readonly delivered = computed(() => this.all().reduce((n, p) => n + p.rhythm.delivered, 0));
  /** vivos (como no Cockpit), quem tem gente trabalhando e alerta primeiro */
  protected readonly products = computed(() => this.all()
    .filter(p => p.owner || p.activeRuns || p.storiesOpen || p.toValidate || p.alerts.length || p.metrics.length)
    .sort((a, b) => this.weight(b) - this.weight(a)));
  private weight(p: Instrument): number { return (p.alerts.length ? 100 : 0) + p.activeRuns * 10 + (p.ownerOn ? 3 : 0) + p.toValidate; }
}
