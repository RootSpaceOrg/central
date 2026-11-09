import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { ExtensionDto } from '../../../../shared/contract';
import { AskService } from '../../../../shared/services/ask/ask.service';
import { IpcService, errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { Icon } from '../../../../shared/ui/icon';
import { metaOf, statusOf } from '../../extension-meta';
import { TranscricaoConfig } from './components/transcricao-config/transcricao-config';
import { WhatsappConfig } from './components/whatsapp-config/whatsapp-config';

/** Dentro de uma extensão: o que ela faz, instalar/habilitar/desinstalar e a configuração dela. */
@Component({
  selector: 'app-extension-page',
  imports: [Icon, RouterLink, WhatsappConfig, TranscricaoConfig],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-[1080px] px-10 pt-7 pb-16">
      <a routerLink="/extensoes" class="inline-flex items-center gap-1.5 text-[13px] text-mute hover:text-text"><app-icon name="back" [size]="14" />Extensões</a>

      @if (ext(); as e) {
        @let m = meta(e.id);
        @let st = status(e);
        <header class="mt-4 flex flex-wrap items-start gap-5">
          <span class="grid size-16 shrink-0 place-items-center rounded-2xl" [style.background]="m.color + '22'" [style.color]="m.color"><app-icon [name]="m.icon" [size]="32" /></span>
          <div class="min-w-0 flex-1">
            <h1 class="flex flex-wrap items-center gap-2.5 font-display text-[30px] font-bold leading-tight tracking-tight">{{ e.name }}
              <span class="rounded-full px-2.5 py-0.5 font-sans text-[12.5px] font-semibold tracking-normal" [class]="st.cls">{{ st.label }}</span></h1>
            <p class="mt-1 max-w-2xl text-[14px] leading-relaxed text-mute">{{ e.description }}</p>
            <p class="mt-1 text-[12px] text-faint">Versão {{ e.version }}</p>
          </div>
          <div class="flex shrink-0 gap-2">
            @if (!e.installed) {
              <button type="button" class="btn btn-primary" (click)="run('ext:install')" [disabled]="busy()"><app-icon name="download" [size]="15" />{{ busy() ? 'Instalando…' : 'Instalar' }}</button>
            } @else {
              <button type="button" class="btn" (click)="run('ext:enable', !e.enabled)" [disabled]="busy()"
                      [title]="e.enabled ? 'Para a extensão sem apagar nada (a sessão e os dados ficam para quando voltar)' : 'Liga de novo'">{{ e.enabled ? 'Desabilitar' : 'Habilitar' }}</button>
              <button type="button" class="btn btn-ghost !text-no" (click)="uninstall(e)" [disabled]="busy()">Desinstalar</button>
            }
          </div>
        </header>
        @if (e.warning) {
          @if (e.installed) { <p class="mt-4 text-[12.5px] leading-relaxed text-later/80">{{ e.warning }}</p> }
          @else { <p class="mt-5 rounded-2xl border border-later/30 bg-later/10 px-5 py-3 text-[13.5px] leading-relaxed text-later">{{ e.warning }}</p> }
        }
        @if (error()) { <p role="alert" class="mt-5 rounded-2xl bg-no/10 px-5 py-3 text-no">{{ error() }}</p> }

        @if (!e.installed || !e.enabled) {
          <section class="mt-8 rounded-3xl border border-edge bg-panel p-6">
            <h2 class="font-semibold">{{ e.installed ? 'Desabilitada' : 'O que ela faz' }}</h2>
            @if (e.installed) {
              <p class="mt-1 text-[13.5px] text-mute">Não roda e não liga quando a Central abre. {{ e.id === 'whatsapp' ? 'Os números continuam vinculados e voltam ao habilitar.' : 'O que foi baixado continua aqui.' }}</p>
            } @else {
              <ul class="mt-3 grid gap-2 sm:grid-cols-2">
                @for (f of m.features; track f) { <li class="flex items-start gap-2 text-[14px]"><app-icon name="check" [size]="16" class="mt-0.5" [style.color]="m.color" />{{ f }}</li> }
              </ul>
            }
          </section>
        } @else {
          @switch (e.id) {
            @case ('whatsapp') { <app-whatsapp-config class="mt-8" /> }
            @case ('transcricao') { <app-transcricao-config class="mt-8" /> }
          }
        }
      } @else if (loaded()) {
        <p class="mt-8 text-mute">Extensão não encontrada.</p>
      }
    </div>
  `,
})
export class ExtensionPage {
  private readonly ipc = inject(IpcService);
  private readonly ask = inject(AskService);
  private readonly router = inject(Router);
  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map(p => p.get('id') ?? '')), { initialValue: '' });

  private readonly list = signal<ExtensionDto[]>([]);
  protected readonly loaded = signal(false);
  protected readonly ext = computed(() => this.list().find(e => e.id === this.id()) ?? null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly meta = metaOf;
  protected readonly status = statusOf;

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(this.ipc.on('ext:changed', () => this.load()));
  }

  private async load(): Promise<void> { this.list.set(await this.ipc.invoke('ext:list')); this.loaded.set(true); }

  protected async run(call: 'ext:install' | 'ext:uninstall' | 'ext:enable', on?: boolean): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      if (call === 'ext:enable') await this.ipc.invoke(call, this.id(), !!on);
      else await this.ipc.invoke(call, this.id());
      await this.load();
    } catch (e) { this.error.set(errorMessage(e)); } finally { this.busy.set(false); }
  }

  protected async uninstall(e: ExtensionDto): Promise<void> {
    const ok = await this.ask.confirm(`Desinstalar ${e.name}?`, {
      message: e.id === 'whatsapp' ? 'Os números são desconectados e a sessão apagada.' : 'O que foi baixado por ela é apagado.', confirmLabel: 'Desinstalar', danger: true,
    });
    if (!ok) return;
    await this.run('ext:uninstall');
    if (!this.error()) this.router.navigate(['/extensoes']);
  }
}
