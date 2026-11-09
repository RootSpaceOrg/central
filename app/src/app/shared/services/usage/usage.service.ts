import { Injectable, computed, inject, signal } from '@angular/core';

import { GovLimits, UsageDto } from '../../contract';
import { IpcService } from '../ipc/ipc.service';
import { UsageApiService } from './usage-api.service';

export interface UsageLimit {
  kind: string;
  label: string;
  percent: number;
  severity: string;
  resetsAt: Date | null;
}

export interface Usage {
  limits: UsageLimit[];
  fetchedAt: Date;
  error: string | null;
}

const toModel = (d: UsageDto): Usage => ({
  limits: d.limits.map(l => ({ kind: l.kind, label: l.label, percent: l.percent, severity: l.severity, resetsAt: l.resets_at ? new Date(l.resets_at) : null })),
  fetchedAt: new Date(d.fetched_at),
  error: d.error,
});

/** "2h 32m", "3d 8h", "12m" até o reset */
export function untilReset(d: Date | null): string {
  if (!d) return '';
  const min = Math.max(Math.round((d.getTime() - Date.now()) / 60000), 0);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Uso do plano do Claude, atualizado a cada 2 minutos e quando um agente termina. */
@Injectable({ providedIn: 'root' })
export class UsageService {
  private readonly api = inject(UsageApiService);

  readonly usage = signal<Usage | null>(null);
  readonly loading = signal(false);
  readonly session = computed(() => this.usage()?.limits.find(l => l.kind === 'session') ?? null);
  readonly weekly = computed(() => this.usage()?.limits.find(l => l.kind === 'weekly_all') ?? null);
  /** quanto da sessão ainda dá para gastar com agentes */
  /** o freio da cota (mesmas faixas de electron/governor.ts): o que está segurando agora */
  /** faixas do freio (Preferências); a mesma regra do processo principal (electron/governor.ts) */
  readonly limits = signal<GovLimits>({ session: [90, 80, 60], week: [95, 90, 80], pause: { session: 95, week: 98 } });
  readonly brake = computed(() => {
    const s = this.session()?.percent ?? 0, w = this.weekly()?.percent ?? 0, l = this.limits();
    if (s >= l.pause.session || w >= l.pause.week) return 'Freio: pausando tudo';
    if (s >= l.session[0] || w >= l.week[0]) return 'Freio: nada começa';
    if (s >= l.session[1] || w >= l.week[1]) return 'Freio: só prioridade alta';
    if (s >= l.session[2] || w >= l.week[2]) return 'Freio: prioridade baixa espera';
    return null;
  });
  private readonly ipc = inject(IpcService);
  loadLimits(): void { this.ipc.invoke('gov:get').then(g => this.limits.set(g.limits)); }
  async saveLimits(l: GovLimits): Promise<void> { this.limits.set(await this.ipc.invoke('gov:set', l)); }
  readonly sessionLeft = computed(() => (this.session() ? 100 - this.session()!.percent : null));

  constructor() {
    this.loadLimits();
    this.ipc.on('gov:changed', () => this.loadLimits());
    this.refresh(false);
    setInterval(() => this.refresh(false), 120_000);
    this.api.onRunUpdate(r => { if (['succeeded', 'failed', 'killed'].includes(r.status)) this.refresh(true); });
  }

  refresh(force = true): void {
    this.loading.set(true);
    this.api.get(force)
      .then(d => this.usage.set(toModel(d)))
      .finally(() => this.loading.set(false));
  }
}
