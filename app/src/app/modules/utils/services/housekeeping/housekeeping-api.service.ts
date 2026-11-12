import { Injectable, inject } from '@angular/core';

import { HousekeepingItem } from '../../../../shared/contract';
import { IpcService } from '../../../../shared/services/ipc/ipc.service';

/** contrato da limpeza (sem camada de domínio: o component só repassaria) */
@Injectable({ providedIn: 'root' })
export class HousekeepingApiService {
  private readonly ipc = inject(IpcService);

  scan() { return this.ipc.invoke('housekeeping:scan'); }
  clean(items: HousekeepingItem[]) { return this.ipc.invoke('housekeeping:clean', items); }
}
