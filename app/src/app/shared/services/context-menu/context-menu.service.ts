import { Injectable, signal } from '@angular/core';

import { IconName } from '../../ui/icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** imagem no lugar do ícone (ex.: logo original do Claude ou do PowerShell) */
  img?: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** texto pequeno à direita (atalho, estado atual) */
  hint?: string;
}

/** null = separador */
export type MenuEntry = MenuItem | null;

/** Menu de botão direito: qualquer tela abre; o shell desenha um só. */
@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  readonly state = signal<{ x: number; y: number; items: MenuEntry[] } | null>(null);

  open(e: MouseEvent, items: MenuEntry[]): void {
    e.preventDefault();
    e.stopPropagation();
    this.state.set({ x: e.clientX, y: e.clientY, items });
  }

  close(): void { this.state.set(null); }
}
