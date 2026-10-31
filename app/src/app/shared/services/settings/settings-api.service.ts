import { Injectable, inject } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';

/** Preferências guardadas no banco local (última visita, modo do dia). Sem domínio: componentes usam direto. */
@Injectable({ providedIn: 'root' })
export class SettingsApiService {
  private readonly ipc = inject(IpcService);

  get(key: string) { return this.ipc.invoke('settings:get', key); }
  set(key: string, value: string) { return this.ipc.invoke('settings:set', key, value); }
}
