import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';

import { IpcService } from '../../services/ipc/ipc.service';
import { Icon } from '../../ui/icon';

/** Ctrl+F (Cmd+F no Mac): busca no texto da tela (conversas, cards, listas), com a busca nativa do Electron. */
@Component({
  selector: 'app-find-bar',
  imports: [Icon],
  host: { '(document:keydown)': 'key($event)' },
  template: `
    @if (open()) {
      <div class="fixed top-12 right-6 z-50 flex items-center gap-1.5 rounded-xl border border-edge bg-panel px-2 py-1.5 shadow-2xl" role="search">
        <app-icon name="search" [size]="15" class="ml-1 text-faint" />
        <input #box class="w-56 bg-transparent px-1 py-1 text-[13.5px] outline-none placeholder:text-faint" placeholder="Buscar na tela" aria-label="Buscar na tela"
               [value]="text()" (input)="search($any($event.target).value)" (keydown.enter)="$event.preventDefault(); next(!$any($event).shiftKey)" (keydown.escape)="close()">
        <span class="min-w-14 text-right text-[12px] tabular-nums text-faint" aria-live="polite">{{ text() ? (matches() ? active() + ' de ' + matches() : 'nada') : '' }}</span>
        <button type="button" class="btn btn-ghost !p-1.5" (click)="next(false)" [disabled]="!matches()" aria-label="Anterior (Shift+Enter)" title="Anterior (Shift+Enter)"><app-icon name="chevron" [size]="14" class="-rotate-90" /></button>
        <button type="button" class="btn btn-ghost !p-1.5" (click)="next(true)" [disabled]="!matches()" aria-label="Próximo (Enter)" title="Próximo (Enter)"><app-icon name="chevron" [size]="14" class="rotate-90" /></button>
        <button type="button" class="btn btn-ghost !p-1.5" (click)="close()" aria-label="Fechar (Esc)" title="Fechar (Esc)"><app-icon name="close" [size]="14" /></button>
      </div>
    }
  `,
})
export class FindBar {
  private readonly ipc = inject(IpcService);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  protected readonly open = signal(false);
  protected readonly text = signal('');
  protected readonly matches = signal(0);
  protected readonly active = signal(0);

  constructor() {
    this.ipc.on('find:result', r => {
      this.matches.set(r.matches);
      this.active.set(r.active);
      // a busca nativa rouba o foco: devolve para a caixa
      this.box()?.nativeElement.focus();
    });
  }

  protected key(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.open.set(true);
      queueMicrotask(() => { const el = this.box()?.nativeElement; el?.focus(); el?.select(); });
    } else if (e.key === 'Escape' && this.open()) this.close();
  }

  protected search(t: string): void {
    this.text.set(t);
    if (!t) { this.ipc.invoke('find:stop'); this.matches.set(0); return; }
    this.ipc.invoke('find:go', t, true, false);
  }

  protected next(forward: boolean): void { if (this.text()) this.ipc.invoke('find:go', this.text(), forward, true); }

  protected close(): void {
    this.open.set(false);
    this.matches.set(0);
    this.ipc.invoke('find:stop');
  }
}
