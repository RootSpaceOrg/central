import { Component, inject, signal } from '@angular/core';

import { DataTransferService } from '../../../../../../shared/services/data-transfer/data-transfer.service';
import { DialogsService } from '../../../../../../shared/services/dialogs/dialogs.service';
import { IpcService, errorMessage } from '../../../../../../shared/services/ipc/ipc.service';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { Icon } from '../../../../../../shared/ui/icon';

const COLORS = ['#3FBF8A', '#7FA2FF', '#E0B44C', '#B48CFF', '#4CC9F0', '#F07167', '#FF9F68'];

/** Primeira abertura (nenhum projeto): achar as pastas de projeto, adicionar uma, ou trazer os dados de outro computador. */
@Component({
  selector: 'app-welcome',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <section class="rounded-3xl border border-frost/30 bg-frost/5 p-7" aria-labelledby="welcome-title">
      <h2 id="welcome-title" class="font-display text-[24px] font-bold tracking-tight">Bem-vindo à Central</h2>
      <p class="mt-1 max-w-2xl text-mute">Comece pelos seus projetos: cada um é uma pasta com um ou mais repositórios. Depois disso, a Central acompanha commits, PRs e backlog, e os agentes trabalham neles.</p>

      <div class="mt-6 grid gap-4 lg:grid-cols-3">
        <!-- achados em Development -->
        <div class="rounded-2xl border border-edge bg-panel p-5 lg:col-span-2">
          <p class="flex items-center gap-2 font-semibold"><app-icon name="folder" [size]="16" />Pastas encontradas em {{ projects.devRoot() || 'Development' }}</p>
          @if (found() === null) { <p class="mt-3 text-[13px] text-mute">Procurando…</p> }
          @else if (!found()!.length) {
            <p class="mt-3 text-[13px] text-mute">Nenhuma pasta com repositório git ainda. Clone seus repositórios lá ou adicione um projeto de outra pasta.</p>
          } @else {
            <ul class="mt-3 max-h-64 space-y-1 overflow-y-auto">
              @for (f of found()!; track f.folder) {
                <li><label class="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-raise">
                  <input type="checkbox" class="accent-frost" [checked]="picked().has(f.folder)" (change)="toggle(f.folder)">
                  <span class="min-w-0 flex-1"><span class="block truncate font-semibold">{{ f.name }}</span>
                    <span class="block truncate font-mono text-[11.5px] text-faint">{{ f.folder }}</span></span>
                  <span class="shrink-0 text-[12px] text-mute">{{ f.repos }} {{ f.repos === 1 ? 'repositório' : 'repositórios' }}</span>
                </label></li>
              }
            </ul>
            <button type="button" class="btn btn-primary mt-3" [disabled]="!picked().size || adding()" (click)="addPicked()">
              <app-icon name="plus" [size]="15" />{{ adding() ? 'Adicionando…' : 'Adicionar ' + picked().size + (picked().size === 1 ? ' projeto' : ' projetos') }}</button>
          }
        </div>
        <div class="space-y-3">
          <button type="button" class="flex w-full items-start gap-3 rounded-2xl border border-edge bg-panel p-4 text-left hover:border-faint" (click)="dialogs.newProject()">
            <app-icon name="plus" [size]="18" class="mt-0.5 text-frost" />
            <span><span class="block font-semibold">Adicionar um projeto</span><span class="block text-[12.5px] text-mute">De qualquer pasta, ou clonando do GitHub.</span></span>
          </button>
          <button type="button" class="flex w-full items-start gap-3 rounded-2xl border border-edge bg-panel p-4 text-left hover:border-faint" (click)="data.import()">
            <app-icon name="download" [size]="18" class="mt-0.5 text-frost" />
            <span><span class="block font-semibold">Trazer de outro computador</span><span class="block text-[12.5px] text-mute">Importe o arquivo exportado lá (Preferências → Sobre → Exportar). Vem tudo: projetos, backlog, agentes, memórias.</span></span>
          </button>
        </div>
      </div>
      @if (error() ?? data.error(); as e) { <p role="alert" class="mt-4 text-[13px] text-no">{{ e }}</p> }
      @if (data.message(); as m) { <p class="mt-4 text-[13px] text-yes">{{ m }}</p> }
    </section>
  `,
})
export class Welcome {
  private readonly ipc = inject(IpcService);
  protected readonly projects = inject(ProjectsService);
  protected readonly dialogs = inject(DialogsService);
  protected readonly data = inject(DataTransferService);

  protected readonly found = signal<{ name: string; folder: string; repos: number }[] | null>(null);
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly adding = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.ipc.invoke('projects:discover').then(list => { this.found.set(list); this.picked.set(new Set(list.map(f => f.folder))); }, () => this.found.set([]));
  }

  protected toggle(folder: string): void {
    const s = new Set(this.picked());
    if (!s.delete(folder)) s.add(folder);
    this.picked.set(s);
  }

  protected async addPicked(): Promise<void> {
    this.adding.set(true);
    this.error.set(null);
    try {
      const list = (this.found() ?? []).filter(f => this.picked().has(f.folder));
      for (const [i, f] of list.entries()) {
        const p = await this.projects.create({ name: f.name, folder: f.folder, status: 'active', color: COLORS[i % COLORS.length], description: '' });
        this.projects.sync(p.slug);
      }
    } catch (e) { this.error.set(errorMessage(e)); } finally { this.adding.set(false); }
  }
}
