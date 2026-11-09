import { Component, input, output } from '@angular/core';

/** Liga/desliga com título e explicação ao lado. A linha inteira é clicável. */
@Component({
  selector: 'app-switch',
  host: { class: 'block' },
  template: `
    <button type="button" role="switch" [attr.aria-checked]="checked()" [disabled]="disabled()" (click)="changed.emit(!checked())"
            class="flex w-full items-start gap-4 rounded-xl px-1 py-1 text-left disabled:opacity-50">
      <span class="min-w-0 flex-1">
        <span class="block font-semibold">{{ label() }}</span>
        @if (hint()) { <span class="mt-0.5 block text-[13px] leading-relaxed text-mute">{{ hint() }}</span> }
        <ng-content />
      </span>
      <span class="relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors" [class]="checked() ? 'bg-yes' : 'bg-edge'" aria-hidden="true">
        <span class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform" [class.translate-x-5]="checked()"></span>
      </span>
    </button>`,
})
export class Switch {
  readonly checked = input(false);
  readonly label = input.required<string>();
  readonly hint = input('');
  readonly disabled = input(false);
  readonly changed = output<boolean>();
}
