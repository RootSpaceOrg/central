import { Injectable, inject } from '@angular/core';

import { NewProposalInput, ProposalStatus, Verdict } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class ProposalsApiService {
  private readonly ipc = inject(IpcService);

  list(statuses: ProposalStatus[]) { return this.ipc.invoke('proposals:list', statuses); }
  create(input: NewProposalInput) { return this.ipc.invoke('proposals:create', input); }
  decide(id: number, verdict: Verdict, reason: string | null) { return this.ipc.invoke('proposals:decide', id, verdict, reason); }
  remove(id: number) { return this.ipc.invoke('proposals:delete', id); }
}
