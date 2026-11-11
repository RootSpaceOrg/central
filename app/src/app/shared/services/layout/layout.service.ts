import { Injectable, inject, signal } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';
import { SettingsApiService } from '../settings/settings-api.service';

const OPERATOR_KEY = 'ui:operator';

/**
 * Moldura do app.
 * - Modo foco: some a moldura (barras, projetos, rodapé) e a janela vai para tela cheia. F11 liga e desliga.
 * - Modo operador: a barra de ícones mostra todas as telas. Desligado (padrão, modo diretor), ela mostra só a Mesa, o
 *   Estúdio e os Bastidores (o índice das telas de operação).
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly ipc = inject(IpcService);
  private readonly settings = inject(SettingsApiService);
  readonly focus = signal(false);
  readonly operator = signal(false);

  constructor() {
    this.settings.get(OPERATOR_KEY).then(v => this.operator.set(v === '1'), () => {});
  }

  setFocus(on: boolean): void {
    this.focus.set(on);
    this.ipc.invoke('window:fullscreen', on);
  }

  toggleFocus(): void { this.setFocus(!this.focus()); }

  setOperator(on: boolean): void {
    this.operator.set(on);
    this.settings.set(OPERATOR_KEY, on ? '1' : '0');
  }
}
