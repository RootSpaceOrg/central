import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Barras de commits por dia (14 dias, a última é hoje). Dia sem commit vira um ponto. */
@Component({
  selector: 'app-heartbeat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-end justify-between gap-[3px]', role: 'img', '[attr.aria-label]': 'label()' },
  template: `
    @for (h of heights(); track $index) {
      <span class="w-[7px] shrink-0 rounded-full"
            [style.height.px]="h || 3"
            [style.background]="h ? color() : 'var(--color-edge)'"
            [style.opacity]="h ? 0.45 + 0.55 * (h / max()) : 1"></span>
    }`,
})
export class Heartbeat {
  readonly values = input.required<number[]>();
  readonly color = input('#7FA2FF');
  readonly height = input(28);

  protected readonly max = computed(() => this.height());
  protected readonly heights = computed(() => {
    const top = Math.max(...this.values(), 1);
    return this.values().map(v => (v ? Math.max(5, Math.round((v / top) * this.height())) : 0));
  });
  protected readonly label = computed(() =>
    `${this.values().reduce((a, b) => a + b, 0)} commits nos últimos ${this.values().length} dias`);
}
