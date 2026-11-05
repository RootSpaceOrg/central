import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ExtensionDto } from '../../../../shared/contract';
import { IpcService, errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { Icon } from '../../../../shared/ui/icon';
import { metaOf, statusOf } from '../../extension-meta';

/**
 * Extensões: integrações instaláveis (o núcleo da Central não carrega o que você não usa). Grade com cada uma;
 * clicar abre a página dela, com a configuração.
 */
@Component({
  selector: 'app-extensions-page',
  imports: [Icon],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-[1180px] px-10 pt-9 pb-16">
      <h1 class="font-display text-[32px] font-bold leading-tight tracking-tight">Extensões</h1>
      <p class="mt-1 max-w-2xl text-mute">Integrações que você instala quando precisa. Cada uma roda separada da Central: se cair, volta sozinha, e nada dela é carregado se não estiver instalada.</p>
      @if (error()) { <p role="alert" class="mt-5 rounded-2xl bg-no/10 px-5 py-3 text-no">{{ error() }}</p> }

      <div class="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        @for (e of list(); track e.id) {
          @let m = meta(e.id);
          @let st = status(e);
          <article tabindex="0" role="link" (click)="open(e)" (keydown.enter)="open(e)" [attr.aria-label]="'Abrir ' + e.name"
                   class="group flex cursor-pointer flex-col rounded-3xl border border-edge bg-panel p-6 outline-none transition-colors hover:border-faint focus-visible:ring-2 focus-visible:ring-frost/60">
            <div class="flex items-start gap-4">
              <span class="grid size-14 shrink-0 place-items-center rounded-2xl" [style.background]="m.color + '22'" [style.color]="m.color"><app-icon [name]="m.icon" [size]="28" /></span>
              <div class="min-w-0 flex-1">
                <h2 class="font-display text-[19px] font-semibold leading-tight">{{ e.name }}</h2>
                <p class="mt-0.5 text-[13px] text-mute">{{ m.tagline }}</p>
              </div>
              <span class="shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold" [class]="st.cls">{{ st.label }}</span>
            </div>
            <p class="mt-4 line-clamp-3 text-[13.5px] leading-relaxed text-mute">{{ e.description }}</p>
            <div class="mt-auto flex items-center gap-2 pt-5">
              <span class="text-[12px] text-faint">v{{ e.version }}</span>
              <span class="flex-1"></span>
              @if (!e.installed) {
                <button type="button" class="btn btn-sm btn-primary" (click)="$event.stopPropagation(); install(e)" [disabled]="busy() === e.id">
                  <app-icon name="download" [size]="14" />{{ busy() === e.id ? 'Instalando…' : 'Instalar' }}</button>
              } @else {
                <span class="flex items-center gap-1 text-[13px] font-semibold text-frost">Configurar<app-icon name="chevron" [size]="13" class="transition-transform group-hover:translate-x-0.5" /></span>
              }
            </div>
          </article>
        }
      </div>
    </div>
  `,
})
export class ExtensionsPage {
  private readonly ipc = inject(IpcService);
  private readonly router = inject(Router);

  protected readonly list = signal<ExtensionDto[]>([]);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly meta = metaOf;
  protected readonly status = statusOf;

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(this.ipc.on('ext:changed', () => this.load()));
  }

  private async load(): Promise<void> { this.list.set(await this.ipc.invoke('ext:list')); }

  protected open(e: ExtensionDto): void { this.router.navigate(['/extensoes', e.id]); }

  /** instalar já leva para dentro, onde está a configuração */
  protected async install(e: ExtensionDto): Promise<void> {
    this.busy.set(e.id);
    this.error.set(null);
    try { await this.ipc.invoke('ext:install', e.id); this.open(e); } catch (err) { this.error.set(errorMessage(err)); } finally { this.busy.set(null); }
  }
}
