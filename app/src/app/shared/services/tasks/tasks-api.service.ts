import { Injectable, inject } from '@angular/core';

import { NewTaskInput, TaskPatch } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class TasksApiService {
  private readonly ipc = inject(IpcService);

  list(slug: string | null) { return this.ipc.invoke('tasks:list', slug); }
  create(input: NewTaskInput) { return this.ipc.invoke('tasks:create', input); }
  update(id: number, patch: TaskPatch) { return this.ipc.invoke('tasks:update', id, patch); }
  remove(id: number) { return this.ipc.invoke('tasks:delete', id); }
  onChanged(cb: () => void) { return this.ipc.on('backlog:changed', cb); }
}
