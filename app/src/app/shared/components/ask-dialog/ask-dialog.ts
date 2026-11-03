import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';

import { AskService } from '../../services/ask/ask.service';

/** O diálogo do AskService: confirmar ou pedir um texto, no visual do app. Enter confirma; Esc ou fundo cancela. */
@Component({
  selector: 'app-ask-dialog',
  template: `
    <dialog #dlg (close)="ask.answer(null)" aria-labelledby="ask-title"
            class="m-auto w-[min(480px,92vw)] rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      @if (ask.state(); as s) {
        <form method="dialog" class="px-7 pt-6 pb-5" (submit)="$event.preventDefault(); submit()">
          <h2 id="ask-title" class="font-display text-xl font-semibold">{{ s.title }}</h2>
          @if (s.message) { <p class="mt-2 leading-relaxed text-mute">{{ s.message }}</p> }
          @if (s.value !== undefined) {
            @if (s.multiline) {
              <textarea #field class="field mt-4 min-h-28 w-full resize-y" [placeholder]="s.placeholder ?? ''" aria-labelledby="ask-title"
                        [value]="value()" (input)="value.set($any($event.target).value)" (keydown.control.enter)="submit()"></textarea>
            } @else {
              <input #field class="field mt-4 w-full" autocomplete="off" [placeholder]="s.placeholder ?? ''" aria-labelledby="ask-title"
                     [value]="value()" (input)="value.set($any($event.target).value)">
            }
          }
          <div class="mt-6 flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" (click)="ask.answer(null)">Cancelar</button>
            <button #ok type="submit" class="btn" [class]="s.danger ? 'bg-no text-night hover:brightness-110' : 'btn-primary'">{{ s.confirmLabel }}</button>
          </div>
        </form>
      }
    </dialog>`,
})
export class AskDialog {
  protected readonly ask = inject(AskService);
  protected readonly value = signal('');
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private readonly field = viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>('field');
  private readonly ok = viewChild<ElementRef<HTMLButtonElement>>('ok');

  constructor() {
    effect(() => {
      const s = this.ask.state();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (s && !el.open) {
        this.value.set(s.value ?? '');
        el.showModal();
        // foco no campo (texto selecionado) ou no botão; excluir não confirma num Enter perdido
        queueMicrotask(() => {
          const f = this.field()?.nativeElement;
          if (f) { f.focus(); f.select(); } else if (!s.danger) this.ok()?.nativeElement.focus();
        });
      }
      if (!s && el.open) el.close();
    });
  }

  protected submit(): void { this.ask.answer(this.ask.state()?.value !== undefined ? this.value() : ''); }
}
