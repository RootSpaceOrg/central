import { Component, computed, effect, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../../../shared/ui/project-avatar';
import { Instrument as Product, OwnerState } from '../../../../services/cockpit/cockpit.service';
import { OwnerStatus } from '../owner-status/owner-status';

const STATE: Record<OwnerState, { label: string; tone: string; ring: string }> = {
  working: { label: 'trabalhando', tone: 'text-yes', ring: 'ck-ring-work' },
  waiting: { label: 'esperando você', tone: 'text-later', ring: 'ck-ring-wait' },
  watching: { label: 'atento', tone: 'text-mute', ring: '' },
  off: { label: 'parado', tone: 'text-faint', ring: '' },
  none: { label: 'sem dono', tone: 'text-faint', ring: '' },
};
const RING = 2 * Math.PI * 26;

/**
 * Um produto no cockpit: o dono (rosto e estado), para onde vai (rumo), quanto falta (meta do marco), o ritmo dos últimos
 * 14 dias e os números combinados. Vivo: a borda brilha enquanto alguém trabalha, pulsa quando algo acontece e acende em
 * vermelho quando quebrou.
 */
@Component({
  selector: 'app-instrument',
  imports: [AgoPipe, Icon, OwnerStatus, ProjectAvatar, RouterLink],
  host: { class: 'block', '(document:keydown.escape)': 'pop.set(null)' },
  template: `
    @let p = product();
    <article class="relative flex h-full flex-col overflow-hidden rounded-[22px] border border-edge bg-panel transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-faint"
             [class.ck-alarm]="p.alerts.length" [class.ck-ping]="ping()" [style.--c]="p.color" (animationend)="ping.set(false)"
             [attr.aria-label]="p.name">
      <span class="ck-edge" [class.live]="p.activeRuns > 0" aria-hidden="true"></span>
      <!-- brilho da cor do produto no canto: identidade sem pesar -->
      <span class="pointer-events-none absolute -top-24 -right-20 size-56 rounded-full opacity-[0.07] blur-2xl" [style.background]="p.color" aria-hidden="true"></span>

      <header class="relative flex items-start gap-3 px-5 pt-5">
        <app-project-avatar [project]="$any(p)" [size]="38" />
        <div class="min-w-0 flex-1">
          <a [routerLink]="['/produtos', p.slug]" class="block truncate font-display text-[18px] font-semibold leading-tight hover:underline">{{ p.name }}</a>
          @if (p.focus) { <p class="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-mute" [title]="p.focus">{{ p.focus }}</p> }
          @else { <p class="mt-0.5 text-[12.5px] text-later">sem rumo escrito</p> }
        </div>
        <!-- o dono: rosto e estado -->
        <button type="button" (click)="openStatus($event)" class="group flex shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-0.5 hover:bg-raise/60"
                [attr.aria-expanded]="!!pop()" [title]="p.owner ? 'O que o dono está fazendo ou esperando' : 'Escolher o dono'">
          <span class="relative grid size-11 place-items-center">
            @if (p.owner) {
              <svg class="absolute inset-0 size-11 {{ state().ring }}" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="20.5" fill="none" stroke-width="1.6" stroke-linecap="round"
                        [attr.stroke]="p.ownerState === 'working' ? 'var(--color-yes)' : p.ownerState === 'waiting' ? 'var(--color-later)' : p.ownerState === 'watching' ? 'color-mix(in srgb, var(--color-yes) 45%, transparent)' : 'var(--color-edge)'"
                        [attr.stroke-dasharray]="p.ownerState === 'working' ? '30 98' : null" />
              </svg>
              <app-project-avatar [project]="$any(p.owner)" [size]="32" />
            } @else {
              <span class="grid size-9 place-items-center rounded-full border border-dashed border-edge text-faint group-hover:text-text"><app-icon name="plus" [size]="15" /></span>
            }
          </span>
          <span class="max-w-[96px] truncate text-[10.5px] font-semibold {{ state().tone }}">{{ reason() }}</span>
        </button>
      </header>

      <!-- instrumentos -->
      <div class="relative mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 px-5">
        <!-- meta do marco atual -->
        <div class="flex items-center gap-3" [title]="p.milestone ? p.milestone.title + ' · ' + p.milestone.done + ' de ' + p.milestone.total : 'Sem marco em Agora'">
          <svg class="size-[64px] -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="26" fill="none" stroke="var(--color-edge)" stroke-width="5" />
            @if (p.milestone?.pct != null) {
              <circle class="ck-draw" cx="32" cy="32" r="26" fill="none" [attr.stroke]="p.color" stroke-width="5" stroke-linecap="round"
                      [attr.stroke-dasharray]="ring" [attr.stroke-dashoffset]="ring * (1 - p.milestone!.pct! / 100)" [style.--len]="ring" />
            }
          </svg>
          <div class="min-w-0 -ml-[70px] w-[64px] text-center">
            <p class="font-display text-[17px] font-bold tabular-nums leading-none">{{ p.milestone?.pct != null ? p.milestone!.pct + '%' : '—' }}</p>
          </div>
        </div>
        <div class="min-w-0 self-center">
          <p class="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Marco atual</p>
          <p class="truncate text-[13px] font-semibold" [title]="p.milestone?.title ?? ''">{{ p.milestone?.title ?? 'nenhum em Agora' }}</p>
          @if (p.milestone) { <p class="text-[11.5px] tabular-nums text-mute">{{ p.milestone.total ? p.milestone.done + ' de ' + p.milestone.total : 'sem histórias ligadas ainda' }}@if (p.milestone.target) { · alvo {{ p.milestone.target }} }</p> }
        </div>
      </div>

      <!-- ritmo: 14 dias -->
      <div class="relative mt-4 px-5">
        <div class="flex items-end justify-between">
          <p class="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Ritmo · 14 dias</p>
          <p class="text-[11.5px] tabular-nums text-mute"><b class="text-text">{{ p.rhythm.delivered }}</b> entregues · <b class="text-yes">{{ p.rhythm.validated }}</b> validadas@if (p.rhythm.returned) { · <b class="text-later">{{ p.rhythm.returned }}</b> voltaram }</p>
        </div>
        <div class="mt-1.5 flex h-9 items-end gap-[3px]" aria-hidden="true">
          @for (d of p.rhythm.days; track $index) {
            <span class="ck-bar flex-1 rounded-[3px]" [style.--i]="$index" [style.height.%]="d ? 18 + (d / maxDay()) * 82 : 6"
                  [style.background]="d ? p.color : 'var(--color-edge)'" [style.opacity]="d ? 0.45 + ($index / 14) * 0.55 : 0.6"></span>
          }
        </div>
      </div>

      <!-- números combinados -->
      @if (p.metrics.length) {
        <div class="relative mt-4 grid grid-cols-2 gap-1.5 px-5">
          @for (m of p.metrics.slice(0, 4); track m.name) {
            <div class="rounded-xl bg-night/60 px-3 py-2" [title]="m.at ? 'medido ' + (m.at | ago) : 'ainda não medido'">
              <p class="truncate text-[10.5px] text-faint">{{ m.name }}</p>
              <p class="flex items-baseline gap-1 text-[18px] font-semibold tabular-nums leading-tight">
                {{ m.value === null ? '—' : fmt(m.value) }}<span class="text-[11px] font-normal text-mute">{{ m.unit }}</span>
                @if (trend(m); as t) { <span class="text-[11px]" [class]="t > 0 ? 'text-yes' : 'text-later'">{{ t > 0 ? '▲' : '▼' }}</span> }
              </p>
              @if (m.target && m.value !== null) {
                <div class="mt-1 h-1 overflow-hidden rounded-full bg-edge"><div class="h-full rounded-full" [style.width.%]="min(100, (m.value / m.target) * 100)" [style.background]="p.color"></div></div>
              }
            </div>
          }
        </div>
      }

      <!-- o que pede atenção -->
      @if (p.alerts.length || p.toValidate || p.decisions || p.oneOnOne || p.returned) {
        <div class="relative mt-4 flex flex-wrap gap-1.5 px-5">
          @for (a of p.alerts; track a.id) { <span class="rounded-full bg-no/15 px-2.5 py-1 text-[11.5px] font-semibold text-no" [title]="a.summary">quebrou · {{ a.at | ago }}</span> }
          @if (p.oneOnOne) { <span class="rounded-full bg-[#B48CFF]/15 px-2.5 py-1 text-[11.5px] font-semibold text-[#C6A6FF]" [title]="p.oneOnOne.why">pediu um 1:1</span> }
          @if (p.toValidate) { <span class="rounded-full bg-frost/15 px-2.5 py-1 text-[11.5px] font-semibold text-frost">{{ p.toValidate }} para você usar</span> }
          @if (p.decisions) { <span class="rounded-full bg-later/15 px-2.5 py-1 text-[11.5px] font-semibold text-later">{{ p.decisions }} {{ p.decisions === 1 ? 'decisão' : 'decisões' }}</span> }
          @if (p.returned) { <span class="rounded-full bg-later/10 px-2.5 py-1 text-[11.5px] text-later">{{ p.returned }} devolvida{{ p.returned === 1 ? '' : 's' }} em conserto</span> }
        </div>
      }

      <span class="flex-1"></span>
      <footer class="relative mt-4 flex items-center gap-3 border-t border-edge/70 px-5 py-3">
        @if (p.diary?.text) {
          <p class="min-w-0 flex-1 truncate text-[12px] text-mute" [title]="p.diary!.text!"><span class="text-faint">{{ p.diary!.at | ago }} ·</span> {{ p.diary!.text }}</p>
        } @else {
          <p class="min-w-0 flex-1 text-[12px] text-faint">{{ p.owner ? (p.ownerOn ? 'o dono ainda não passou por aqui' : 'dono parado: ligue na sala do produto') : 'escolha um dono na sala do produto' }}</p>
        }
        <a [routerLink]="['/produtos', p.slug]" class="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition hover:bg-raise"
           [class]="p.oneOnOne || p.guideOpen ? 'border-[#B48CFF]/60 text-[#C6A6FF]' : 'border-edge text-text'">
          <app-icon name="central" [size]="13" />{{ p.guideOpen ? '1:1 aberto' : '1:1' }}</a>
      </footer>
    </article>
    @if (pop(); as at) {
      <div class="fixed inset-0 z-40" (click)="pop.set(null)" aria-hidden="true"></div>
      <app-owner-status class="fixed z-50" [style.top.px]="at.top" [style.left.px]="at.left" [product]="p" (close)="pop.set(null)" />
    }`,
})
export class InstrumentCard {
  readonly product = input.required<Product>();
  protected readonly ring = RING;
  protected readonly state = computed(() => STATE[this.product().ownerState]);
  protected readonly maxDay = computed(() => Math.max(1, ...this.product().rhythm.days));
  /** algo aconteceu no produto (entrega, dono começou ou terminou): uma onda sai do cartão */
  protected readonly ping = signal(false);
  /** o painel do dono aberto (posição na tela) */
  protected readonly pop = signal<{ top: number; left: number } | null>(null);
  /** o estado com o motivo: "esperando você · 6 decisões", "trabalhando · 2" */
  protected readonly reason = computed(() => {
    const p = this.product();
    const s = this.state().label;
    if (p.ownerState === 'waiting') {
      const bits = [p.oneOnOne ? '1:1' : '', p.decisions ? `${p.decisions} ${p.decisions === 1 ? 'decisão' : 'decisões'}` : ''].filter(Boolean);
      return bits.length ? `${s} · ${bits.join(', ')}` : s;
    }
    if (p.ownerState === 'working' && p.activeRuns > 1) return `${s} · ${p.activeRuns}`;
    return s;
  });

  protected openStatus(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const w = 380, h = Math.min(window.innerHeight * 0.75, 520);
    const left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12));
    const top = r.bottom + 8 + h > window.innerHeight ? Math.max(12, r.top - h - 8) : r.bottom + 8;
    this.pop.set(this.pop() ? null : { top, left });
  }
  private last: string | null = null;

  constructor() {
    effect(() => {
      const p = this.product();
      const sig = `${p.rhythm.delivered}|${p.rhythm.validated}|${p.ownerState}|${p.toValidate}|${p.alerts.length}`;
      untracked(() => { if (this.last !== null && this.last !== sig) this.ping.set(true); this.last = sig; });
    });
  }

  protected fmt(v: number): string { return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
  protected min(a: number, b: number): number { return Math.min(a, b); }
  protected trend(m: Product['metrics'][number]): number { return m.prev === null || m.value === null || m.prev === m.value ? 0 : m.value > m.prev ? 1 : -1; }
}
