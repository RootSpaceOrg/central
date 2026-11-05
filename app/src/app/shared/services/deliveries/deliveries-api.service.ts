import { Injectable, inject } from '@angular/core';

import { DeliveryStatus } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class DeliveriesApiService {
  private readonly ipc = inject(IpcService);

  list(since: string | null, status: DeliveryStatus | null) { return this.ipc.invoke('deliveries:list', since, status); }
  board() { return this.ipc.invoke('deliveries:board'); }
  review(id: number, action: 'accepted' | 'adjusting' | 'discarded', note: string | null) { return this.ipc.invoke('deliveries:review', id, action, note); }
  digest(since: string) { return this.ipc.invoke('digest:get', since); }
  /** execução terminou, agente contou a entrega, revisão: tudo avisa por aqui */
  onChanged(cb: () => void) { return this.ipc.on('backlog:changed', cb); }
}
