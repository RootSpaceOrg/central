import { Injectable, inject, signal } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';

/** Modo foco: some a moldura do app (barras, projetos, rodapé) e a janela vai para tela cheia. F11 liga e desliga. */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly ipc = inject(IpcService);
  readonly focus = signal(false);

  setFocus(on: boolean): void {
    this.focus.set(on);
    this.ipc.invoke('window:fullscreen', on);
  }

  toggleFocus(): void { this.setFocus(!this.focus()); }
}
