import { Injectable, inject } from '@angular/core';

import { IpcService } from '../../../../shared/services/ipc/ipc.service';

/** Contrato de arquivos. O explorador consome direto (só repassaria); o editor passa pelo EditorService. */
@Injectable({ providedIn: 'root' })
export class FilesApiService {
  private readonly ipc = inject(IpcService);

  list(dir: string) { return this.ipc.invoke('fs:list', dir); }
  read(path: string) { return this.ipc.invoke('fs:read', path); }
  write(path: string, content: string) { return this.ipc.invoke('fs:write', path, content); }
}
