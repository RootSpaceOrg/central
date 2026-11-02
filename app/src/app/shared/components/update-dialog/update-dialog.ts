import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';

import { DialogsService } from '../../services/dialogs/dialogs.service';
import { UpdateService } from '../../services/update/update.service';
import { AgoPipe } from '../../ui/ago.pipe';
import { Icon } from '../../ui/icon';

/** Atualizar a Central sem sair dela: instalar a versão pronta ou gerar uma a partir do código. */
@Component({
  selector: 'app-update-dialog',
  imports: [Icon, AgoPipe],
  template: `
    <dialog #dlg (close)="dialogs.update.set(false)" aria-labelledby="up-title"
            class="m-auto w-[min(640px,92vw)] rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      <header class="flex items-start justify-between gap-4 px-8 pt-7 pb-4">
        <div>
          <h2 id="up-title" class="font-display text-2xl font-semibold">Atualizar a Central</h2>
          <p class="mt-1 text-mute">Versão instalada: <b class="text-text">{{ update.info()?.current }}</b></p>
        </div>
        <button type="button" class="btn btn-ghost !p-2" (click)="dialogs.update.set(false)" aria-label="Fechar"><app-icon name="close" /></button>
      </header>

      <div class="space-y-5 px-8 pb-6">
        @if (update.available(); as v) {
          <div class="flex items-center gap-4 rounded-2xl border border-yes/40 bg-yes/10 p-4">
            <app-icon name="download" [size]="28" class="text-yes" />
            <div class="flex-1">
              <p class="font-semibold">Versão {{ v }} pronta</p>
              <p class="text-[13px] text-mute">
                {{ update.info()?.source === 'github' ? 'Publicada no GitHub' : 'Gerada nesta máquina' }} {{ update.info()?.builtAt ?? null | ago }}.
                {{ update.info()?.source === 'github' ? 'A Central baixa, instala' : 'A Central fecha, instala' }} e abre de novo sozinha.</p>
            </div>
            <button type="button" class="btn btn-primary" (click)="update.install()" [disabled]="update.installing() || update.building()">
              {{ update.installing() ? 'Instalando…' : 'Instalar e reiniciar' }}</button>
          </div>
        } @else {
          <p class="rounded-2xl bg-night px-4 py-3 text-mute">Você está na versão mais recente, aqui e no GitHub.
            <button type="button" class="ml-1 text-frost hover:underline" (click)="update.check(true)">Verificar de novo</button></p>
          @if (update.info()?.githubError; as err) { <p class="text-[13px] text-later">{{ err }}</p> }
        }

        <div>
          <p class="font-semibold">Gerar nova versão a partir do código</p>
          <p class="mt-1 text-[13px] text-mute">
            Roda <code class="font-mono text-frost">npm run dist</code> em
            <span class="font-mono text-[12px]">{{ update.info()?.sourceDir }}</span>. A versão sobe sozinha (ex.: 0.4.0 → 0.4.1).
            Use depois de mudar o código da Central. Leva uns 2 minutos.</p>
          @if (update.info() && !update.info()!.sourceExists) {
            <p class="mt-2 text-[13px] text-no">Código da Central não encontrado nessa pasta.</p>
          }
          <div class="mt-3 flex items-center gap-4">
            <button type="button" class="btn" (click)="update.build(publish())" [disabled]="update.building() || !update.info()?.sourceExists">
              <app-icon name="sync" [size]="17" [class.animate-spin]="update.building()" />{{ update.building() ? 'Gerando…' : 'Gerar versão' }}</button>
            <label class="flex cursor-pointer items-center gap-2 text-[13.5px] text-mute">
              <input type="checkbox" class="accent-frost" [checked]="publish()" (change)="publish.set($any($event.target).checked)">
              Publicar no GitHub (RootSpaceOrg/central)</label>
          </div>
        </div>

        @if (update.log().length) {
          <pre #log class="max-h-56 overflow-auto rounded-2xl bg-night p-4 font-mono text-[11.5px] leading-relaxed text-mute selectable">{{ update.log().join('\n') }}</pre>
        }
        @if (update.result(); as r) {
          <p role="status" [class]="r.ok ? 'text-yes' : 'text-no'">{{ r.message }}</p>
        }
      </div>
    </dialog>`,
})
export class UpdateDialog {
  protected readonly dialogs = inject(DialogsService);
  protected readonly update = inject(UpdateService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private readonly logEl = viewChild<ElementRef<HTMLElement>>('log');
  /** publicar a versão gerada como release no GitHub (outras máquinas atualizam por lá) */
  protected readonly publish = signal(true);

  constructor() {
    effect(() => {
      const open = this.dialogs.update();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (open && !el.open) { this.update.check(true); el.showModal(); }
      if (!open && el.open) el.close();
    });
    // log sempre no fim
    effect(() => {
      this.update.log();
      const el = this.logEl()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
  }
}
