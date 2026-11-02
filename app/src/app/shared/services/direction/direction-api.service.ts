import { Injectable, inject } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class DirectionApiService {
  private readonly ipc = inject(IpcService);

  get(slug: string) { return this.ipc.invoke('direction:get', slug); }
  history(slug: string) { return this.ipc.invoke('direction:history', slug); }
  set(slug: string, text: string, note: string | null) { return this.ipc.invoke('direction:set', slug, text, note); }
  plan(slug: string, request: string | null) { return this.ipc.invoke('backlog:plan', slug, request); }
  /** agentes também mexem no rumo (update_direction) */
  onChanged(cb: () => void) { return this.ipc.on('projects:changed', cb); }
}
