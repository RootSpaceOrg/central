import { Injectable, inject } from '@angular/core';

import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class InsightsApiService {
  private readonly ipc = inject(IpcService);

  /** reunião: texto colado ou arquivo escolhido na hora (file: true); devolve a execução que lê, ou null se cancelou */
  meeting(input: { title: string; text: string | null; file: boolean; project_slug: string | null }) { return this.ipc.invoke('insights:meeting', input); }
}
