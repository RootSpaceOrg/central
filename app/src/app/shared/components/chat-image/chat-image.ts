import { Component, effect, inject, input, signal } from '@angular/core';

import { IpcService } from '../../services/ipc/ipc.service';

/** Imagem de uma mensagem do chat (print colado). Clicar abre no visualizador do Windows. */
@Component({
  selector: 'app-chat-image',
  host: { class: 'block' },
  template: `
    <button type="button" class="block overflow-hidden rounded-xl border border-edge bg-night" (click)="open()" title="Abrir imagem" aria-label="Abrir imagem">
      @if (src()) { <img [src]="src()" alt="Imagem enviada" class="block max-h-64 max-w-full object-contain"> }
      @else { <span class="block size-24 animate-pulse bg-raise"></span> }
    </button>`,
})
export class ChatImage {
  private readonly ipc = inject(IpcService);
  readonly path = input.required<string>();
  protected readonly src = signal('');

  constructor() {
    effect(() => { this.ipc.invoke('chat:image', this.path()).then(u => this.src.set(u), () => this.src.set('')); });
  }

  protected open(): void { this.ipc.invoke('shell:reveal', this.path()); }
}
