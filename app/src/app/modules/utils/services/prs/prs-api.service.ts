import { Injectable, inject } from '@angular/core';

import { PrFilter } from '../../../../shared/contract';
import { IpcService } from '../../../../shared/services/ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class PrsApiService {
  private readonly ipc = inject(IpcService);

  list(filter: PrFilter, fresh: boolean) { return this.ipc.invoke('prs:list', filter, fresh); }
}
