import { Injectable, inject } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class PulseApiService {
  private readonly ipc = inject(IpcService);

  status() { return this.ipc.invoke('pulse:status'); }
  run(slug: string | null = null) { return this.ipc.invoke('pulse:run', slug); }
  onChanged(cb: () => void) { return this.ipc.on('backlog:changed', cb); }
}
