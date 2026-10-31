import { Injectable, computed, inject, signal } from '@angular/core';

import { UpdateInfoDto } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { UpdateApiService } from './update-api.service';

export interface UpdateInfo {
  current: string;
  latest: string | null;
  builtAt: Date | null;
  sourceDir: string;
  sourceExists: boolean;
  source: 'local' | 'github' | null;
  githubError: string | null;
}

const toModel = (d: UpdateInfoDto): UpdateInfo => ({
  current: d.current, latest: d.latest, builtAt: d.built_at ? new Date(d.built_at) : null,
  sourceDir: d.source_dir, sourceExists: d.source_exists, source: d.source, githubError: d.github_error,
});

/** Versão instalada x versão disponível em app/release; gerar e instalar. Confere a cada 30 min. */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly api = inject(UpdateApiService);

  readonly info = signal<UpdateInfo | null>(null);
  readonly available = computed(() => this.info()?.latest ?? null);
  readonly building = signal(false);
  readonly installing = signal(false);
  readonly log = signal<string[]>([]);
  readonly result = signal<{ ok: boolean; message: string } | null>(null);

  constructor() {
    this.api.onLog(({ line }) => this.log.update(l => [...l.slice(-400), line]));
    this.api.onBuilt(r => { this.building.set(false); this.result.set(r); this.check(); });
    this.check();
    setInterval(() => this.check(), 30 * 60_000);
  }

  check(force = false): void {
    this.api.check(force).then(d => { this.info.set(toModel(d)); if (d.building) this.building.set(true); });
  }

  async build(publish: boolean): Promise<void> {
    this.log.set([]);
    this.result.set(null);
    this.building.set(true);
    try {
      await this.api.build(publish);
    } catch (e) {
      this.building.set(false);
      this.result.set({ ok: false, message: errorMessage(e) });
    }
  }

  async install(): Promise<void> {
    this.installing.set(true);
    try {
      await this.api.install();
    } catch (e) {
      this.installing.set(false);
      this.result.set({ ok: false, message: errorMessage(e) });
    }
  }
}
