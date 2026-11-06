import { Injectable, inject, signal } from '@angular/core';

import { AskService } from '../ask/ask.service';
import { IpcService, errorMessage } from '../ipc/ipc.service';

const LABEL: Record<string, string> = { projects: 'projetos', tasks: 'tarefas', ideas: 'ideias', agents: 'agentes', chats: 'conversas', memories: 'memórias', routines: 'rotinas' };

/** Levar a Central para outro computador: exportar tudo num arquivo e importar (substitui os dados daqui e reabre). */
@Injectable({ providedIn: 'root' })
export class DataTransferService {
  private readonly ipc = inject(IpcService);
  private readonly ask = inject(AskService);

  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  async export(): Promise<void> {
    this.error.set(null);
    try {
      const path = await this.ipc.invoke('data:export');
      if (path) this.message.set(`Dados exportados para ${path}. Leve o arquivo para o outro computador e use Importar lá.`);
    } catch (e) { this.error.set(errorMessage(e)); }
  }

  async import(): Promise<void> {
    this.error.set(null);
    try {
      const picked = await this.ipc.invoke('data:pickImport');
      if (!picked) return;
      const what = Object.entries(picked.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${LABEL[k] ?? k}`).join(', ') || 'nada';
      const ok = await this.ask.confirm('Importar estes dados?', {
        message: `O arquivo tem ${what}. Ele substitui os dados desta Central (os de agora ficam guardados como backup ao lado do banco). As pastas dos projetos são ajustadas para este computador, e a Central reabre sozinha.`,
        confirmLabel: 'Importar e reabrir', danger: true,
      });
      if (!ok) return;
      this.message.set('Importando… a Central vai reabrir.');
      await this.ipc.invoke('data:import', picked.path);
    } catch (e) { this.error.set(errorMessage(e)); this.message.set(null); }
  }
}
