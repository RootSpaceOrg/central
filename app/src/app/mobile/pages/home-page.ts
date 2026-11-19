import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ProjectAvatar } from '../../shared/ui/project-avatar';
import { CockpitService, Instrument } from '../../modules/cockpit/services/cockpit/cockpit.service';
import { MobileScope, ScopePicker } from '../scope';

const STATE: Record<string, { label: string; tone: string }> = {
  working: { label: 'trabalhando', tone: 'text-yes' }, waiting: { label: 'esperando você', tone: 'text-later' },
  watching: { label: 'atento', tone: 'text-mute' }, off: { label: 'parado', tone: 'text-faint' }, none: { label: 'sem dono', tone: 'text-faint' },
};

/** Início no celular: quem trabalha agora e cada produto em uma linha (dono, marco, o que espera você) */
@Component({
  selector: 'app-mobile-home',
  imports: [ProjectAvatar, RouterLink, ScopePicker],
  host: { class: 'block px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6' },
  template: `
    <header class="flex items-center gap-3">
      <img src="logo.png" alt="" class="size-9 rounded-xl" />
      <div class="flex-1">
        <h1 class="font-display text-[22px] font-bold leading-none">Central</h1>
        <p class="mt-1 text-[13px] text-mute">@if (working()) { <span class="pulse mr-1 inline-block size-2 rounded-full bg-yes"></span> }{{ working() }} {{ working() === 1 ? 'agente trabalhando' : 'agentes trabalhando' }}</p>
      </div>
      @if (waiting(); as n) { <a routerLink="/para-voce" class="rounded-full bg-later/15 px-3 py-1.5 text-[13px] font-bold text-later">{{ n }} para você</a> }
    </header>
    <div class="mt-3"><app-scope-picker /></div>

    @for (a of alerts(); track a.id) {
      <a routerLink="/para-voce" class="mt-4 block rounded-2xl border border-no/60 bg-no/[0.08] px-4 py-3">
        <p class="text-[11.5px] font-bold uppercase tracking-wider text-no">Quebrou · {{ a.product }}</p>
        <p class="mt-0.5 text-[14px] leading-snug">{{ a.summary }}</p>
      </a>
    }

    <ul class="mt-5 space-y-2.5">
      @for (p of products(); track p.slug) {
        @let st = state(p);
        <li class="rounded-2xl border border-edge bg-panel px-4 py-3" [class.border-yes/40]="p.activeRuns > 0">
          <div class="flex items-center gap-3">
            <app-project-avatar [project]="$any(p)" [size]="32" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold">{{ p.name }}</p>
              <p class="truncate text-[12.5px]" [class]="st.tone">{{ p.owner?.name ?? 'sem dono' }} · {{ st.label }}</p>
            </div>
            @if (p.activeRuns) { <span class="flex items-center gap-1 rounded-full bg-yes/15 px-2 py-0.5 text-[12px] font-bold text-yes"><span class="pulse size-1.5 rounded-full bg-yes"></span>{{ p.activeRuns }}</span> }
          </div>
          @if (p.milestone; as m) {
            <div class="mt-2.5">
              <p class="flex text-[12px] text-mute"><span class="min-w-0 flex-1 truncate">{{ m.title }}</span>@if (m.pct !== null) { <span class="ml-2 tabular-nums">{{ m.pct }}%</span> }</p>
              <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-raise"><div class="h-full rounded-full" [style.width.%]="m.pct ?? 0" [style.background]="p.color"></div></div>
            </div>
          }
          @if (p.toValidate || p.decisions) {
            <p class="mt-2 flex gap-2 text-[12px]">
              @if (p.toValidate) { <span class="rounded-full bg-frost/15 px-2 py-0.5 font-semibold text-frost">{{ p.toValidate }} para usar</span> }
              @if (p.decisions) { <span class="rounded-full bg-later/15 px-2 py-0.5 font-semibold text-later">{{ p.decisions }} {{ p.decisions === 1 ? 'decisão' : 'decisões' }}</span> }
            </p>
          }
        </li>
      } @empty { <li class="py-10 text-center text-mute">Carregando…</li> }
    </ul>`,
})
export class HomePage {
  private readonly cockpit = inject(CockpitService);
  private readonly scope = inject(MobileScope);
  private readonly all = computed(() => this.cockpit.companies().flatMap(c => c.products).filter(p => this.scope.matches(p.slug)));
  protected readonly products = computed(() => this.all()
    .filter(p => p.owner || p.activeRuns || p.storiesOpen || p.toValidate || p.alerts.length || p.metrics.length)
    .sort((a, b) => b.activeRuns - a.activeRuns || (b.toValidate + b.decisions) - (a.toValidate + a.decisions)));
  protected readonly working = computed(() => this.all().reduce((n, p) => n + p.activeRuns, 0));
  protected readonly waiting = computed(() => this.all().reduce((n, p) => n + p.toValidate + p.decisions, 0));
  protected readonly alerts = computed(() => this.all().flatMap(p => p.alerts.map(a => ({ ...a, product: p.name }))));
  protected state(p: Instrument) { return STATE[p.ownerState] ?? STATE['none']; }
}
