import { Injectable, computed, inject, signal } from '@angular/core';

import { UsageDto } from '../../contract';
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
  readonly sessionLeft = computed(() => (this.session() ? 100 - this.session()!.percent : null));

  constructor() {
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
