import { Injectable, inject } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class ActivityApiService {
  private readonly ipc = inject(IpcService);

  recent(slug: string | null, days: number, limit: number) { return this.ipc.invoke('commits:recent', slug, days, limit); }
}
