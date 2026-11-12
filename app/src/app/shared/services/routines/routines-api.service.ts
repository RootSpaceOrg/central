import { Injectable, inject } from '@angular/core';

import { NewRoutineInput, RoutinePatch } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class RoutinesApiService {
  private readonly ipc = inject(IpcService);

  list() { return this.ipc.invoke('routines:list'); }
  create(input: NewRoutineInput) { return this.ipc.invoke('routines:create', input); }
  update(id: number, patch: RoutinePatch) { return this.ipc.invoke('routines:update', id, patch); }
  remove(id: number) { return this.ipc.invoke('routines:delete', id); }
  fire(id: number) { return this.ipc.invoke('routines:fire', id); }
  onChanged(cb: () => void) {
    const a = this.ipc.on('routines:changed', cb);
    // só execução de rotina muda a lista de rotinas (as outras chegavam aqui e recarregavam tudo à toa)
    const b = this.ipc.on('run:update', r => { if (r.routine_id) cb(); });
    return () => { a(); b(); };
  }
}
