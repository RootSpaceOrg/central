import { Injectable, inject, signal } from '@angular/core';

import { PulseAction, PulseItemDto, PulseStatusDto } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { PulseApiService } from './pulse-api.service';

export type { PulseAction };
export interface PulseItem { slug: string; name: string; action: PulseAction; text: string; runId: number | null }
export interface PulseStatus { at: Date | null; manual: boolean; items: PulseItem[]; window: string }

const toItem = (d: PulseItemDto): PulseItem => ({ slug: d.slug, name: d.name, action: d.action, text: d.text, runId: d.run_id ?? null });
const toStatus = (d: PulseStatusDto): PulseStatus => ({
  at: d.last ? new Date(d.last.at) : null, manual: d.last?.manual ?? false, items: d.last?.items.map(toItem) ?? [], window: d.window,
});

export const PULSE_LABEL: Record<PulseAction, string> = {
  started: 'Agente trabalhando', planning: 'Planejando', waiting: 'Esperando você', empty: 'Sem tarefa', blocked: 'Travado', quota: 'Cota alta',
};

/** Piloto automático: o que a última passada da madrugada fez em cada projeto. */
@Injectable({ providedIn: 'root' })
export class PulseService {
  private readonly api = inject(PulseApiService);

  readonly status = signal<PulseStatus | null>(null);
  readonly running = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.load();
    this.api.onChanged(() => this.load());
  }

  load(): void { this.api.status().then(s => this.status.set(toStatus(s))); }

  /** "Rodar agora": a mesma passada da madrugada, fora da janela (respeita as travas e a cota). */
  async runNow(slug: string | null = null): Promise<void> {
    this.running.set(true);
    this.error.set(null);
    try {
      this.status.set(toStatus(await this.api.run(slug)));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.running.set(false);
    }
  }
}
