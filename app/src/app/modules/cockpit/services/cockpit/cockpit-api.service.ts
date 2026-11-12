import { Injectable, inject } from '@angular/core';

import { IpcService } from '../../../../shared/services/ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class CockpitApiService {
  private readonly ipc = inject(IpcService);

  get() { return this.ipc.invoke('cockpit:get'); }
  resolveAlert(id: number) { return this.ipc.invoke('alerts:resolve', id); }
  closed(slug: string) { return this.ipc.invoke('cleanup:closed', slug); }
  reopen(kind: 'decision' | 'review', id: number) { return this.ipc.invoke('cleanup:reopen', kind, id); }
  onChanged(cb: () => void) {
    const off = [this.ipc.on('projects:changed', cb), this.ipc.on('backlog:changed', cb)];
    return () => off.forEach(f => f());
  }
}
