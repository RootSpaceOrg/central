import { Injectable, inject } from '@angular/core';

import { IpcService } from '../../../../shared/services/ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class CockpitApiService {
  private readonly ipc = inject(IpcService);

  get() { return this.ipc.invoke('cockpit:get'); }
  resolveAlert(id: number) { return this.ipc.invoke('alerts:resolve', id); }
  onChanged(cb: () => void) {
    const off = [this.ipc.on('projects:changed', cb), this.ipc.on('backlog:changed', cb)];
    return () => off.forEach(f => f());
  }
}
