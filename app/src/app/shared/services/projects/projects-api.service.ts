import { Injectable, inject } from '@angular/core';

import { CloneProgressDto, NewProjectInput, ProjectPatch } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class ProjectsApiService {
  private readonly ipc = inject(IpcService);

  list() { return this.ipc.invoke('projects:list'); }
  create(input: NewProjectInput) { return this.ipc.invoke('projects:create', input); }
  update(slug: string, patch: ProjectPatch) { return this.ipc.invoke('projects:update', slug, patch); }
  sync(slug: string | null) { return this.ipc.invoke('projects:sync', slug); }
  repos(slug: string) { return this.ipc.invoke('repos:list', slug); }
  onChanged(cb: () => void) { return this.ipc.on('projects:changed', cb); }
  info() { return this.ipc.invoke('app:info'); }
  pickFolder(defaultPath: string) { return this.ipc.invoke('dialog:folder', defaultPath); }
  reveal(path: string) { return this.ipc.invoke('shell:reveal', path); }
  openInVsCode(path: string) { return this.ipc.invoke('shell:vscode', path); }
  openExternal(url: string) { return this.ipc.invoke('shell:external', url); }
  githubRepos() { return this.ipc.invoke('github:repos'); }
  clone(fullName: string, folder: string) { return this.ipc.invoke('github:clone', fullName, folder); }
  onCloneProgress(cb: (p: CloneProgressDto) => void) { return this.ipc.on('clone:progress', cb); }
}
