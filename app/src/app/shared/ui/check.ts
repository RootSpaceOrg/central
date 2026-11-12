import { Component, input, output } from '@angular/core';

/**
 * Caixa de seleção da Central: o input nativo (teclado, label e leitor de tela continuam valendo) com o visual próprio,
 * marcado, parcial (indeterminate) e foco. Use dentro de um <label> para o texto também marcar.
 */
@Component({
  selector: 'app-check',
  host: { class: 'relative inline-grid size-[18px] shrink-0 place-items-center' },
  template: `
    <input type="checkbox" [checked]="checked()" [indeterminate]="indeterminate()" [disabled]="disabled()" [attr.aria-label]="label() || null"
           (change)="changed.emit($any($event.target).checked)"           class="peer size-[18px] cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-faint/70 bg-night/40 transition-all duration-150
                  hover:border-frost checked:border-frost checked:bg-frost indeterminate:border-frost indeterminate:bg-frost
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-frost disabled:cursor-not-allowed disabled:opacity-50" />
    <svg viewBox="0 0 16 16" aria-hidden="true" class="pointer-events-none absolute size-3 text-night opacity-0 transition-all duration-150 scale-50 peer-checked:scale-100 peer-checked:opacity-100 peer-indeterminate:!opacity-0">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <span aria-hidden="true" class="pointer-events-none absolute h-[2.4px] w-2 rounded-full bg-night opacity-0 peer-indeterminate:opacity-100"></span>`,
})
export class Check {
  readonly checked = input(false);
  readonly indeterminate = input(false);
  readonly disabled = input(false);
  readonly label = input('');
  readonly changed = output<boolean>();
}
