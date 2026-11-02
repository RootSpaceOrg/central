import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';

import { Prefs } from '../../contract';
import { DialogsService } from '../../services/dialogs/dialogs.service';
import { errorMessage } from '../../services/ipc/ipc.service';
import { PrefsApiService } from '../../services/prefs/prefs-api.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { UpdateService } from '../../services/update/update.service';
import { Icon } from '../../ui/icon';
import { CHAT_WIDTHS, ChatPrefsService, FONT_MAX, FONT_MIN } from '../../services/chat-prefs/chat-prefs.service';

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
      <section class="mx-8 mb-6 rounded-2xl border border-edge px-4 py-4" aria-labelledby="st-chat">
        <div class="flex items-baseline justify-between">
          <h3 id="st-chat" class="font-semibold">Chat das sessões</h3>
          <button type="button" class="text-[12px] text-faint hover:text-text" (click)="chat.reset()">Padrão</button>
        </div>
        <p class="text-[13px] text-mute">Vale para todas as conversas (sessões, Grade e painel da Central). Dentro de uma conversa: Ctrl + / Ctrl − / Ctrl 0.</p>
        <label class="mt-4 flex items-center gap-3 text-[13px]">
          <span class="w-28 shrink-0">Tamanho do texto</span>
          <input type="range" class="flex-1 accent-[var(--color-frost)]" [min]="fontMin" [max]="fontMax" step="1" [value]="chat.prefs().fontSize"
                 (input)="chat.set({ fontSize: +$any($event.target).value })" aria-label="Tamanho do texto do chat" />
          <span class="w-12 text-right tabular-nums text-mute">{{ chat.prefs().fontSize }} px</span>
        </label>
        <div class="mt-3 flex items-center gap-3 text-[13px]">
          <span class="w-28 shrink-0">Largura</span>
          <div class="flex flex-1 rounded-lg border border-edge p-0.5" role="radiogroup" aria-label="Largura da conversa">
            @for (w of widths; track w.id) {
              <button type="button" role="radio" [attr.aria-checked]="chat.prefs().width === w.id" (click)="chat.set({ width: w.id })"
                      class="flex-1 rounded-md py-1 text-[12.5px]" [class]="chat.prefs().width === w.id ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-text'">{{ w.label }}</button>
            }
          </div>
        </div>
        <div class="mt-4 rounded-xl bg-night px-4 py-3" [style.font-size.px]="chat.prefs().fontSize" aria-hidden="true">
          <p class="leading-relaxed">Assim fica uma resposta: <b>texto</b>, listas e <code class="rounded bg-raise px-1 font-mono text-[0.86em] text-frost">código</code> acompanham o tamanho.</p>
        </div>
      </section>
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
  protected readonly chat = inject(ChatPrefsService);
  protected readonly widths = CHAT_WIDTHS;
  protected readonly fontMin = FONT_MIN;
  protected readonly fontMax = FONT_MAX;
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
