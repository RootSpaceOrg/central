import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';

import { Prefs } from '../../contract';
import { DialogsService } from '../../services/dialogs/dialogs.service';
import { errorMessage } from '../../services/ipc/ipc.service';
import { PrefsApiService } from '../../services/prefs/prefs-api.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { UpdateService } from '../../services/update/update.service';
import { Icon } from '../../ui/icon';

const OPTIONS: { key: keyof Prefs; title: string; hint: string }[] = [
  { key: 'tray', title: 'Continuar rodando na bandeja', hint: 'Fechar a janela esconde a Central perto do relógio. Rotinas, turnos e agentes seguem trabalhando.' },
  { key: 'autostart', title: 'Abrir com o Windows', hint: 'A Central inicia minimizada na bandeja, pronta para as rotinas da manhã.' },
  { key: 'notify', title: 'Notificações', hint: 'Avisa quando um agente ou rotina termina, quando um turno acaba e quando o CI quebra.' },
];

@Component({
  selector: 'app-settings-dialog',
  imports: [Icon],
  template: `
    <dialog #dlg (close)="dialogs.settings.set(false)" aria-labelledby="st-title"
            class="m-auto w-[min(600px,92vw)] rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      <header class="flex items-start justify-between gap-4 px-8 pt-7 pb-4">
        <div>
          <h2 id="st-title" class="font-display text-2xl font-semibold">Preferências</h2>
          <p class="mt-1 text-mute">Versão {{ update.info()?.current }}. Dados em %APPDATA%\\Central.</p>
        </div>
        <button type="button" class="btn btn-ghost !p-2" (click)="dialogs.settings.set(false)" aria-label="Fechar"><app-icon name="close" /></button>
      </header>
      <ul class="space-y-2 px-8 pb-6">
        @for (o of options; track o.key) {
          <li class="flex items-center gap-4 rounded-2xl border border-edge px-4 py-3">
            <div class="flex-1">
              <p class="font-semibold">{{ o.title }}</p>
              <p class="text-[13px] text-mute">{{ o.hint }}</p>
            </div>
            <button type="button" role="switch" [attr.aria-checked]="prefs()?.[o.key]" (click)="toggle(o.key)" [attr.aria-label]="o.title"
                    class="relative h-6 w-11 shrink-0 rounded-full transition-colors" [class]="prefs()?.[o.key] ? 'bg-yes' : 'bg-edge'">
              <span class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform" [class.translate-x-5]="prefs()?.[o.key]"></span>
            </button>
          </li>
        }
        @if (error()) { <li role="alert" class="text-[13px] text-no">{{ error() }}</li> }
      </ul>
      <footer class="flex items-center gap-2 border-t border-edge px-8 py-4">
        <span class="font-mono text-[11.5px] text-faint">Projetos em {{ projects.devRoot() }}</span>
        <span class="flex-1"></span>
        <button type="button" class="btn btn-sm" (click)="dialogs.settings.set(false); dialogs.update.set(true)"><app-icon name="download" [size]="14" />Atualizações</button>
      </footer>
    </dialog>`,
})
export class SettingsDialog {
  protected readonly dialogs = inject(DialogsService);
  protected readonly projects = inject(ProjectsService);
  protected readonly update = inject(UpdateService);
  private readonly api = inject(PrefsApiService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly options = OPTIONS;
  protected readonly prefs = signal<Prefs | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const open = this.dialogs.settings();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (open && !el.open) { this.api.get().then(p => this.prefs.set(p)); el.showModal(); }
      if (!open && el.open) el.close();
    });
  }

  protected async toggle(key: keyof Prefs): Promise<void> {
    const cur = this.prefs();
    if (!cur) return;
    this.prefs.set({ ...cur, [key]: !cur[key] });
    try {
      this.prefs.set(await this.api.set({ [key]: !cur[key] }));
      this.error.set(null);
    } catch (e) {
      this.prefs.set(cur);
      this.error.set(errorMessage(e));
    }
  }
}
