import { Injectable, inject } from '@angular/core';

import { NewTerminalInput } from '../../../../shared/contract';
import { IpcService } from '../../../../shared/services/ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class TerminalsApiService {
  private readonly ipc = inject(IpcService);

  create(input: NewTerminalInput) { return this.ipc.invoke('pty:create', input); }
  write(id: number, data: string) { return this.ipc.invoke('pty:write', id, data); }
  resize(id: number, cols: number, rows: number) { return this.ipc.invoke('pty:resize', id, cols, rows); }
  kill(id: number) { return this.ipc.invoke('pty:kill', id); }
  onData(cb: (p: { id: number; data: string }) => void) { return this.ipc.on('pty:data', cb); }
  onExit(cb: (p: { id: number; code: number }) => void) { return this.ipc.on('pty:exit', cb); }
}
