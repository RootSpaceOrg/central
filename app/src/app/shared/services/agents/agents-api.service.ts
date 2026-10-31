import { Injectable, inject } from '@angular/core';

import { AgentPatch, NewAgentInput } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class AgentsApiService {
  private readonly ipc = inject(IpcService);

  list() { return this.ipc.invoke('agents:list'); }
  create(input: NewAgentInput) { return this.ipc.invoke('agents:create', input); }
  update(id: number, patch: AgentPatch) { return this.ipc.invoke('agents:update', id, patch); }
  remove(id: number) { return this.ipc.invoke('agents:delete', id); }
  onChanged(cb: () => void) { return this.ipc.on('agents:changed', cb); }
}
