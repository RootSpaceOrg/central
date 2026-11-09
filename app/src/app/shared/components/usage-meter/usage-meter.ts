import { Component, inject } from '@angular/core';

import { UsageLimit, UsageService, untilReset } from '../../services/usage/usage.service';
import { Icon } from '../../ui/icon';

/** Uso do plano do Claude no rodapé: sessão com barra, semana e limites por modelo. */
@Component({
  selector: 'app-usage-meter',
  imports: [Icon],
  host: { class: 'flex items-center gap-3' },
  template: `
    @if (usage.usage(); as u) {
      @if (u.error && !u.limits.length) {
        <span class="text-later" [title]="u.error">{{ u.error }}</span>
      }
      @for (l of u.limits; track l.kind + l.label; let first = $first) {
        <span class="flex items-center gap-2" [title]="title(l)">
          @if (first) {
            <app-icon name="spark" [size]="15" class="text-[#E8956B]" />
            <span class="h-1.5 w-14 overflow-hidden rounded-full bg-edge">
              <span class="block h-full rounded-full" [class]="bar(l)" [style.width.%]="l.percent"></span>
            </span>
          } @else {
            <span class="text-faint">·</span>
          }
          <span class="tabular-nums" [class]="tone(l)">{{ l.percent }}% {{ first ? 'usado' : l.label }}</span>
          @if (l.resetsAt && l.percent > 0) { <span class="tabular-nums text-faint">{{ reset(l) }}</span> }
        </span>
      }
      @if (usage.brake(); as b) {
        <span class="rounded-full bg-later/15 px-2 py-0.5 text-[12px] font-semibold text-later" title="A fila segura o que começa conforme a prioridade de cada agente; perto do limite pausa e retoma sozinho depois.">{{ b }}</span>
      }
    } @else {
      <span class="text-faint">Lendo uso do Claude…</span>
    }
    <button type="button" class="grid size-6 place-items-center rounded hover:bg-raise hover:text-text" (click)="usage.refresh()"
            title="Atualizar uso do Claude" aria-label="Atualizar uso do Claude">
      <app-icon name="sync" [size]="14" [class.animate-spin]="usage.loading()" />
    </button>`,
})
export class UsageMeter {
  protected readonly usage = inject(UsageService);

  protected reset(l: UsageLimit): string { return untilReset(l.resetsAt); }

  protected title(l: UsageLimit): string {
    const when = l.resetsAt ? `, reinicia ${l.resetsAt.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
    return `${l.label}: ${l.percent}% usado${when}`;
  }

  protected tone(l: UsageLimit): string {
    return l.percent >= 90 || l.severity === 'critical' ? 'text-no' : l.percent >= 70 || l.severity === 'warning' ? 'text-later' : 'text-text/80';
  }

  protected bar(l: UsageLimit): string {
    return l.percent >= 90 ? 'bg-no' : l.percent >= 70 ? 'bg-later' : 'bg-frost';
  }
}
