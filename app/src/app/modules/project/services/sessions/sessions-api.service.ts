import { Injectable, inject } from '@angular/core';

import { SessionKind } from '../../../../shared/contract';
import { IpcService } from '../../../../shared/services/ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class SessionsApiService {
  private readonly ipc = inject(IpcService);

  list(slug: string) { return this.ipc.invoke('sessions:list', slug); }
  create(slug: string, kind: SessionKind, chatId: number | null = null) { return this.ipc.invoke('sessions:create', slug, kind, chatId); }
  update(id: number, patch: { title?: string; chat_id?: number }) { return this.ipc.invoke('sessions:update', id, patch); }
  close(id: number) { return this.ipc.invoke('sessions:close', id); }
}
