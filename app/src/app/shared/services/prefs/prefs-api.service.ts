import { Injectable, inject } from '@angular/core';

import { Prefs } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

/** Preferências do app (bandeja, iniciar com o Windows, notificações). Sem domínio: o diálogo usa direto. */
@Injectable({ providedIn: 'root' })
export class PrefsApiService {
  private readonly ipc = inject(IpcService);

  get() { return this.ipc.invoke('prefs:get'); }
  set(patch: Partial<Prefs>) { return this.ipc.invoke('prefs:set', patch); }
  onNavigate(cb: (route: string) => void) { return this.ipc.on('app:navigate', cb); }
}
