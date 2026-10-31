import { Injectable, inject } from '@angular/core';

import { RunDto } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class UsageApiService {
  private readonly ipc = inject(IpcService);

  get(force: boolean) { return this.ipc.invoke('usage:get', force); }
  onRunUpdate(cb: (r: RunDto) => void) { return this.ipc.on('run:update', cb); }
}
