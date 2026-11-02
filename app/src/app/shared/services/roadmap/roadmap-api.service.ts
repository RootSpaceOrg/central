import { Injectable, inject } from '@angular/core';

import { Horizon, MilestoneInput } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class RoadmapApiService {
  private readonly ipc = inject(IpcService);

  list() { return this.ipc.invoke('milestones:list', null); }
  create(slug: string, input: MilestoneInput) { return this.ipc.invoke('milestones:create', slug, input); }
  update(id: number, input: MilestoneInput) { return this.ipc.invoke('milestones:update', id, input); }
  remove(id: number) { return this.ipc.invoke('milestones:delete', id); }
  reorder(ids: number[], horizon: Horizon) { return this.ipc.invoke('milestones:reorder', ids, horizon); }
  /** agentes mexem no roadmap pelo MCP; tarefas andando mudam o progresso */
  onChanged(cb: () => void) { return this.ipc.on('backlog:changed', cb); }
}
