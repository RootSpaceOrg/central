import { Injectable, inject } from '@angular/core';

import { IpcService } from '../../../../shared/services/ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class PulseApiService {
  private readonly ipc = inject(IpcService);

  get() { return this.ipc.invoke('pulse:get'); }
}
