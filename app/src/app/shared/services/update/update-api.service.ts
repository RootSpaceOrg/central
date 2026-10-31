import { Injectable, inject } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class UpdateApiService {
  private readonly ipc = inject(IpcService);

  check() { return this.ipc.invoke('update:check'); }
  install() { return this.ipc.invoke('update:install'); }
  build() { return this.ipc.invoke('update:build'); }
  onLog(cb: (p: { line: string }) => void) { return this.ipc.on('update:log', cb); }
  onBuilt(cb: (p: { ok: boolean; message: string }) => void) { return this.ipc.on('update:built', cb); }
}
