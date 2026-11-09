import { Injectable, signal } from '@angular/core';

export interface AskState {
  title: string;
  message?: string;
  /** presente = pede um texto (já preenchido com este valor) */
  value?: string;
  multiline?: boolean;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (v: string | null) => void;
}

/**
 * prompt()/confirm() na tela da Central. O Electron não implementa window.prompt() (devolve nada), e o confirm nativo
 * foge do visual do app. Qualquer tela chama; o shell desenha um diálogo só.
 */
@Injectable({ providedIn: 'root' })
export class AskService {
  readonly state = signal<AskState | null>(null);

  /** texto ou null (cancelou). Texto vazio é resposta válida (ex.: limpar a descrição). */
  text(title: string, value = '', opts: { message?: string; multiline?: boolean; placeholder?: string; confirmLabel?: string } = {}): Promise<string | null> {
    return this.open({ title, value, confirmLabel: 'Salvar', ...opts });
  }

  confirm(title: string, opts: { message?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
    return this.open({ title, confirmLabel: 'Confirmar', ...opts }).then(v => v !== null);
  }

  private open(s: Omit<AskState, 'resolve'>): Promise<string | null> {
    this.state()?.resolve(null); // um por vez: o anterior conta como cancelado
    return new Promise(resolve => this.state.set({ ...s, resolve }));
  }

  answer(v: string | null): void {
    const s = this.state();
    this.state.set(null);
    s?.resolve(v);
  }
}
