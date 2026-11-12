import { Injectable, inject, signal } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';
import { SettingsApiService } from '../settings/settings-api.service';

const OPERATOR_KEY = 'ui:operator';
const PINNED_KEY = 'ui:pinned';
/** telas fixadas na barra do modo diretor (botão direito na barra muda) */
const PINNED_DEFAULT = ['/agentes', '/rotinas', '/escritorio'];

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
  readonly pinned = signal<string[]>(PINNED_DEFAULT);

  constructor() {
    this.settings.get(OPERATOR_KEY).then(v => this.operator.set(v === '1'), () => {});
    this.settings.get(PINNED_KEY).then(v => { if (v) this.pinned.set(JSON.parse(v)); }, () => {});
  }

  setFocus(on: boolean): void {
    this.focus.set(on);
    this.ipc.invoke('window:fullscreen', on);
  }

  toggleFocus(): void { this.setFocus(!this.focus()); }

  /** modo apresentação: janela própria no outro monitor, em tela cheia */
  present(displayId: number | null = null): void { this.ipc.invoke('present:open', displayId); }
  displays() { return this.ipc.invoke('present:displays'); }

  /** fixa ou tira uma tela da barra do modo diretor */
  togglePin(path: string): void {
    const next = this.pinned().includes(path) ? this.pinned().filter(p => p !== path) : [...this.pinned(), path];
    this.pinned.set(next);
    this.settings.set(PINNED_KEY, JSON.stringify(next));
  }

  setOperator(on: boolean): void {
    this.operator.set(on);
    this.settings.set(OPERATOR_KEY, on ? '1' : '0');
  }
}
