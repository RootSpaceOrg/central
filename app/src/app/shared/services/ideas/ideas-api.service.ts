import { Injectable, inject } from '@angular/core';

import { IdeaPatch, NewIdeaInput } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class IdeasApiService {
  private readonly ipc = inject(IpcService);

  list() { return this.ipc.invoke('ideas:list'); }
  create(input: NewIdeaInput) { return this.ipc.invoke('ideas:create', input); }
  update(id: number, patch: IdeaPatch) { return this.ipc.invoke('ideas:update', id, patch); }
  promote(id: number, slug: string) { return this.ipc.invoke('ideas:promote', id, slug); }
  importPending() { return this.ipc.invoke('ideas:import'); }
  onChanged(cb: () => void) { return this.ipc.on('backlog:changed', cb); }
}
