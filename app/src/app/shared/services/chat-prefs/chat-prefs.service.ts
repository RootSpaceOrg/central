import { Injectable, computed, inject, signal } from '@angular/core';

import { SettingsApiService } from '../settings/settings-api.service';

export type ChatWidth = 'narrow' | 'medium' | 'wide' | 'full';
export interface ChatPrefs { fontSize: number; width: ChatWidth }

export const CHAT_WIDTHS: { id: ChatWidth; label: string; px: number | null }[] = [
  { id: 'narrow', label: 'Estreita', px: 760 },
  { id: 'medium', label: 'Média', px: 980 },
  { id: 'wide', label: 'Larga', px: 1280 },
  { id: 'full', label: 'Toda a área', px: null },
];
export const FONT_MIN = 11;
export const FONT_MAX = 18;
const DEFAULT: ChatPrefs = { fontSize: 13, width: 'wide' };
const KEY = 'chat:prefs';

/** Como as conversas aparecem (tamanho do texto e largura da coluna). Vale para todas as sessões e o painel da Central. */
@Injectable({ providedIn: 'root' })
export class ChatPrefsService {
  private readonly settings = inject(SettingsApiService);

  readonly prefs = signal<ChatPrefs>(DEFAULT);
  /** largura máxima da coluna da conversa (null = toda a área) */
  readonly maxWidth = computed(() => CHAT_WIDTHS.find(w => w.id === this.prefs().width)?.px ?? null);

  constructor() {
    this.settings.get(KEY).then(raw => { if (raw) this.prefs.set({ ...DEFAULT, ...JSON.parse(raw) }); });
  }

  set(patch: Partial<ChatPrefs>): void {
    const next = { ...this.prefs(), ...patch };
    next.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(next.fontSize)));
    this.prefs.set(next);
    this.settings.set(KEY, JSON.stringify(next));
  }

  /** Ctrl + / Ctrl - dentro da conversa */
  bump(delta: number): void { this.set({ fontSize: this.prefs().fontSize + delta }); }

  reset(): void { this.set(DEFAULT); }
}
