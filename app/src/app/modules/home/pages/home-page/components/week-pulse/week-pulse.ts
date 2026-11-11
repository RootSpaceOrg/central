import { Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DeliveriesService } from '../../../../../../shared/services/deliveries/deliveries.service';
import { RunsService } from '../../../../../../shared/services/runs/runs.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { Metric, PulseService } from '../../../../services/pulse/pulse.service';

/**
 * A semana: as duas medidas do Gustavo (histórias validadas e resultado dos produtos) e, por projeto, se o dono está
 * agindo sozinho e quando passou por último.
 */
@Component({
  selector: 'app-week-pulse',
  imports: [AgoPipe, Icon, RouterLink],
  template: `
    @if (svc.pulse(); as w) {
      <section class="rounded-3xl border border-edge bg-panel p-5" aria-labelledby="semana">
        <h2 id="semana" class="flex items-center gap-2 font-display text-lg font-semibold"><app-icon name="check" [size]="18" class="text-yes" />Esta semana</h2>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <div class="rounded-2xl bg-night/50 px-4 py-3">
            <p class="font-display text-[28px] font-bold leading-none tabular-nums text-yes">{{ w.validated }}</p>
            <p class="mt-1 text-[12.5px] text-mute">{{ w.validated === 1 ? 'história validada' : 'histórias validadas' }}</p>
          </div>
          <div class="rounded-2xl bg-night/50 px-4 py-3">
            <p class="font-display text-[28px] font-bold leading-none tabular-nums" [class]="w.returned ? 'text-later' : 'text-faint'">{{ w.returned }}</p>
            <p class="mt-1 text-[12.5px] text-mute">{{ w.returned === 1 ? 'voltou' : 'voltaram' }} com "não funcionou"</p>
          </div>
        </div>

        <ul class="mt-4 space-y-3">
          @for (p of shown(); track p.slug) {
            <li class="rounded-2xl border border-edge px-3.5 py-3">
              <a [routerLink]="['/projetos', p.slug]" [queryParams]="{ aba: 'dono' }" class="flex items-center gap-2 text-[13.5px] font-semibold hover:underline">
                <span class="size-2.5 rounded-[3px]" [style.background]="p.color"></span>{{ p.name }}
                <span class="ml-auto text-[11.5px] font-normal" [class]="p.ownerOn ? 'text-yes' : 'text-faint'"
                      [title]="p.ownerOn ? 'O dono age sozinho pelos eventos' : 'O dono só pega o A fazer'">
                  {{ p.ownerOn ? (p.lastPassAt ? 'dono passou ' + (p.lastPassAt | ago) : 'dono ligado') : (p.owner ? 'dono desligado' : 'sem dono') }}</span>
              </a>
              <p class="mt-1 text-[12px] text-mute">
                {{ p.storiesOpen }} {{ p.storiesOpen === 1 ? 'história andando' : 'histórias andando' }}@if (p.validated || p.returned) { · {{ p.validated }} validada{{ p.validated === 1 ? '' : 's' }}@if (p.returned) {, {{ p.returned }} voltou} }</p>
              @if (p.metrics.length) {
                <div class="mt-2 grid grid-cols-2 gap-1.5">
                  @for (m of p.metrics; track m.name) {
                    <div class="rounded-xl bg-night/50 px-2.5 py-1.5" [title]="(m.note ?? '') + ' · medido ' + (m.at | ago)">
                      <p class="truncate text-[11px] text-faint">{{ m.name }}</p>
                      <p class="flex items-baseline gap-1 text-[15px] font-semibold tabular-nums">{{ fmt(m.value) }}<span class="text-[11px] font-normal text-mute">{{ m.unit }}</span>
                        @if (trend(m); as t) { <span class="text-[11px]" [class]="t > 0 ? 'text-yes' : 'text-later'">{{ t > 0 ? '▲' : '▼' }}</span> }</p>
                    </div>
                  }
                </div>
              }
            </li>
          }
        </ul>
        <p class="mt-3 text-[11.5px] leading-snug text-faint">Os números dos produtos vêm dos donos (report_metric), quando eles medem.</p>
      </section>
    }`,
})
export class WeekPulse {
  protected readonly svc = inject(PulseService);
  private readonly runs = inject(RunsService);
  private readonly deliveries = inject(DeliveriesService);

  /** projetos com dono, histórias ou números (os outros só fazem barulho aqui) */
  protected readonly shown = computed(() => (this.svc.pulse()?.projects ?? []).filter(p => p.owner || p.storiesOpen || p.metrics.length));

  constructor() {
    // recarrega quando execuções ou entregas andam
    effect(() => { this.runs.runs().length; this.deliveries.queue().length; this.svc.load(); });
  }

  protected fmt(v: number): string { return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
  protected trend(m: Metric): number { return m.prev === null || m.prev === m.value ? 0 : m.value > m.prev ? 1 : -1; }
}
