import { Injectable, inject } from '@angular/core';

import { NewTurnInput } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class TurnsApiService {
  private readonly ipc = inject(IpcService);

  list() { return this.ipc.invoke('turns:list'); }
  start(input: NewTurnInput) { return this.ipc.invoke('turns:start', input); }
  stop(id: number) { return this.ipc.invoke('turns:stop', id); }
  onChanged(cb: () => void) {
    const a = this.ipc.on('backlog:changed', cb);
    const b = this.ipc.on('run:update', r => { if (r.turn_id) cb(); });
    return () => { a(); b(); };
  }
}
