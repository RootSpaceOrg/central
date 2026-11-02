import { Injectable, inject } from '@angular/core';

import { MemoryKind, NewMemoryInput } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class MemoriesApiService {
  private readonly ipc = inject(IpcService);

  list(scope: number | 'shared' | 'all', retired = false) { return this.ipc.invoke('memories:list', scope, retired); }
  create(input: NewMemoryInput) { return this.ipc.invoke('memories:create', input); }
  update(id: number, patch: { text?: string; kind?: MemoryKind; pinned?: boolean; agent_id?: number | null }) { return this.ipc.invoke('memories:update', id, patch); }
  forget(id: number, reason: string) { return this.ipc.invoke('memories:forget', id, reason); }
  remove(id: number) { return this.ipc.invoke('memories:delete', id); }
  /** agentes guardam pelo MCP; a tela mexe pelo IPC: os dois avisam aqui */
  onChanged(cb: () => void) { return this.ipc.on('agents:changed', cb); }
}
