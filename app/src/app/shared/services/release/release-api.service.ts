import { Injectable, inject } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class ReleaseApiService {
  private readonly ipc = inject(IpcService);

  status(slug: string, refresh = false) { return this.ipc.invoke('release:status', slug, refresh); }
  summary() { return this.ipc.invoke('release:summary'); }
}
