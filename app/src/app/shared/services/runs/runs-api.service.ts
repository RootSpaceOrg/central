import { Injectable, inject } from '@angular/core';

import { NewRunInput, RunDto, RunEventDto } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class RunsApiService {
  private readonly ipc = inject(IpcService);

  list(slug: string | null) { return this.ipc.invoke('runs:list', slug); }
  start(input: NewRunInput) { return this.ipc.invoke('runs:start', input); }
  kill(id: number) { return this.ipc.invoke('runs:kill', id); }
  resume(id: number, note: string | null) { return this.ipc.invoke('runs:resume', id, note); }
  events(id: number) { return this.ipc.invoke('runs:events', id); }
  onEvent(cb: (e: RunEventDto) => void) { return this.ipc.on('run:event', cb); }
  onUpdate(cb: (r: RunDto) => void) { return this.ipc.on('run:update', cb); }
}
