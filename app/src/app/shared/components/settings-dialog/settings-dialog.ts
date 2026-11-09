import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';

import { GovLimits, Prefs } from '../../contract';
import { DialogsService } from '../../services/dialogs/dialogs.service';
import { IpcService, errorMessage } from '../../services/ipc/ipc.service';
import { PrefsApiService } from '../../services/prefs/prefs-api.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { UpdateService } from '../../services/update/update.service';
import { UsageService } from '../../services/usage/usage.service';
import { Icon, IconName } from '../../ui/icon';
import { McpSettings } from '../mcp-settings/mcp-settings';
import { NotifSettings } from '../notif-settings/notif-settings';
import { DataTransferService } from '../../services/data-transfer/data-transfer.service';
import { CHAT_WIDTHS, ChatPrefsService, FONT_MAX, FONT_MIN } from '../../services/chat-prefs/chat-prefs.service';

/** Presets do freio. Com 100%, só para quando a cota acaba de fato. */
const PRESETS: { id: string; label: string; hint: string; limits: GovLimits }[] = [
  { id: 'off', label: 'Sem freio', hint: 'Agentes trabalham até a cota acabar. Sem folga para você.', limits: { session: [100, 100, 100], week: [100, 100, 100], pause: { session: 100, week: 100 } } },
  { id: 'push', label: 'Acelerado', hint: 'Usa quase tudo; sobra um pouco para você.', limits: { session: [95, 90, 80], week: [98, 95, 90], pause: { session: 98, week: 99 } } },
  { id: 'default', label: 'Equilibrado', hint: 'O padrão: baixa prioridade para cedo, alta vai longe.', limits: { session: [90, 80, 60], week: [95, 90, 80], pause: { session: 95, week: 98 } } },
  { id: 'saver', label: 'Econômico', hint: 'Deixa boa parte da cota para você usar fora da Central.', limits: { session: [75, 60, 40], week: [85, 75, 60], pause: { session: 90, week: 95 } } },
  { id: 'urgent', label: 'Só o urgente', hint: 'Só agentes de prioridade alta começam trabalho.', limits: { session: [85, 0, 0], week: [90, 0, 0], pause: { session: 95, week: 98 } } },
];

type Tab = 'general' | 'notif' | 'chat' | 'quota' | 'mcps' | 'about';
const TABS: { id: Tab; label: string; icon: IconName; hint: string }[] = [
  { id: 'general', label: 'Geral', icon: 'settings', hint: 'Como a Central roda no Windows e quando ela te avisa.' },
  { id: 'notif', label: 'Notificações', icon: 'flag', hint: 'O que avisa no sistema, o som e o horário de não perturbe.' },
  { id: 'chat', label: 'Chat', icon: 'central', hint: 'Aparência das conversas com os agentes.' },
  { id: 'quota', label: 'Cota do Claude', icon: 'timer', hint: 'Quando os agentes param de começar trabalho para não estourar a cota.' },
  { id: 'mcps', label: 'MCPs', icon: 'puzzle', hint: 'Servidores MCP do Claude Code: o que os agentes podem usar, o status de cada um, adicionar e remover.' },
  { id: 'about', label: 'Sobre', icon: 'download', hint: 'Versão, onde ficam os dados e atualizações.' },
];

const OPTIONS: { key: keyof Prefs; title: string; hint: string }[] = [
  { key: 'tray', title: 'Continuar rodando na bandeja', hint: 'Fechar a janela esconde a Central perto do relógio. Rotinas, turnos e agentes seguem trabalhando.' },
  { key: 'autostart', title: 'Abrir com o Windows', hint: 'A Central inicia minimizada na bandeja, pronta para as rotinas da manhã.' },
  { key: 'notify', title: 'Notificações', hint: 'Avisa quando um agente ou rotina termina, quando um turno acaba e quando o CI quebra.' },
];

@Component({
  selector: 'app-settings-dialog',
  imports: [Icon, McpSettings, NotifSettings],
  template: `
    <dialog #dlg (close)="dialogs.settings.set(false)" aria-labelledby="st-title"
            class="m-auto h-[min(640px,88vh)] w-[min(920px,94vw)] overflow-hidden rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      <div class="flex h-full">
        <!-- navegação por tipo de ajuste -->
        <nav class="flex w-56 shrink-0 flex-col border-r border-edge bg-night/40 px-3 py-6" aria-label="Seções das preferências">
          <h2 id="st-title" class="px-3 font-display text-xl font-semibold">Preferências</h2>
          <ul class="mt-5 space-y-1" role="tablist" aria-orientation="vertical">
            @for (t of tabs; track t.id) {
              <li><button type="button" role="tab" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)"
                          class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px]"
                          [class]="tab() === t.id ? 'bg-raise font-semibold text-text' : 'text-mute hover:bg-raise/50 hover:text-text'">
                <app-icon [name]="t.icon" [size]="16" />{{ t.label }}</button></li>
            }
          </ul>
          <p class="mt-auto px-3 text-[12px] text-faint">Versão {{ update.info()?.current }}</p>
        </nav>

        <div class="flex min-w-0 flex-1 flex-col">
          <header class="flex items-start justify-between gap-4 px-8 pt-7 pb-4">
            <div>
              <h3 class="font-display text-[20px] font-semibold">{{ current().label }}</h3>
              <p class="mt-0.5 text-[13px] text-mute">{{ current().hint }}</p>
            </div>
            <button type="button" class="btn btn-ghost !p-2" (click)="dialogs.settings.set(false)" aria-label="Fechar"><app-icon name="close" /></button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto px-8 pb-8" role="tabpanel">
            @switch (tab()) {
              @case ('general') {
      <ul class="space-y-2">
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
              }
              @case ('chat') {
<section class="rounded-2xl border border-edge px-4 py-4" aria-labelledby="st-chat">
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
              }
              @case ('quota') {
                <!-- presets: um clique ajusta a tabela toda -->
                <div class="grid grid-cols-2 gap-2 lg:grid-cols-3" role="radiogroup" aria-label="Preset do freio">
                  @for (p of presets; track p.id) {
                    <button type="button" role="radio" [attr.aria-checked]="preset() === p.id" (click)="applyPreset(p.limits)"
                            class="rounded-2xl border-2 px-4 py-3 text-left transition-colors" [class]="preset() === p.id ? 'border-frost bg-frost/10' : 'border-edge hover:border-faint'">
                      <span class="flex items-center gap-2 font-semibold">{{ p.label }}@if (preset() === p.id) { <app-icon name="check" [size]="14" class="ml-auto text-frost" /> }</span>
                      <span class="mt-0.5 block text-[12.5px] leading-snug text-mute">{{ p.hint }}</span>
                    </button>
                  }
                  @if (!preset()) {
                    <div class="rounded-2xl border-2 border-frost bg-frost/10 px-4 py-3" role="radio" aria-checked="true">
                      <span class="block font-semibold">Personalizado</span><span class="mt-0.5 block text-[12.5px] text-mute">Ajustado à mão na tabela abaixo.</span></div>
                  }
                </div>
                @if (error()) { <p role="alert" class="mt-3 text-[13px] text-no">{{ error() }}</p> }
<section class="mt-5 rounded-2xl border border-edge px-4 py-4" aria-labelledby="st-gov">
        <div class="flex items-baseline justify-between">
          <h3 id="st-gov" class="font-semibold">Ajuste fino</h3>
        </div>
        <p class="text-[13px] text-mute">Até quanto da cota cada prioridade de agente ainda <b class="text-text">começa</b> trabalho novo. A prioridade é de cada agente (aba Trabalho).</p>
        @let l = usage.limits();
        <table class="mt-3 w-full text-[13px]">
          <thead><tr class="text-left text-faint"><th class="font-normal">Prioridade</th><th class="w-28 font-normal">Sessão</th><th class="w-28 font-normal">Semana</th></tr></thead>
          <tbody>
            @for (p of prios; track p.i) {
              <tr>
                <td class="py-1">{{ p.label }}</td>
                <td class="py-1"><label class="flex items-center gap-1"><input type="number" min="0" max="100" class="field !w-16 !py-1 text-center" [value]="l.session[p.i]" (change)="setLimit('session', p.i, $any($event.target).value)" [attr.aria-label]="p.label + ': sessão'">%</label></td>
                <td class="py-1"><label class="flex items-center gap-1"><input type="number" min="0" max="100" class="field !w-16 !py-1 text-center" [value]="l.week[p.i]" (change)="setLimit('week', p.i, $any($event.target).value)" [attr.aria-label]="p.label + ': semana'">%</label></td>
              </tr>
            }
            <tr class="border-t border-edge">
              <td class="pt-2">Pausar quem está rodando</td>
              <td class="pt-2"><label class="flex items-center gap-1"><input type="number" min="0" max="100" class="field !w-16 !py-1 text-center" [value]="l.pause.session" (change)="setPause('session', $any($event.target).value)" aria-label="Pausar: sessão">%</label></td>
              <td class="pt-2"><label class="flex items-center gap-1"><input type="number" min="0" max="100" class="field !w-16 !py-1 text-center" [value]="l.pause.week" (change)="setPause('week', $any($event.target).value)" aria-label="Pausar: semana">%</label></td>
            </tr>
          </tbody>
        </table>
        <p class="mt-2 text-[12px] text-faint">Pausadas voltam sozinhas, na mesma sessão, quando a cota renova. A cota conta também o que você usa fora da Central: deixe folga.</p>
      </section>
              }
              @case ('notif') { <app-notif-settings /> }
              @case ('mcps') { <app-mcp-settings /> }
              @case ('about') {
                <dl class="space-y-3 text-[13.5px]">
                  <div class="rounded-2xl border border-edge px-4 py-3"><dt class="text-mute">Versão</dt><dd class="mt-0.5 font-semibold">{{ update.info()?.current }}</dd></div>
                  <div class="rounded-2xl border border-edge px-4 py-3"><dt class="text-mute">Dados</dt><dd class="mt-0.5 font-mono text-[12.5px] selectable">{{ dataDir() }}</dd></div>
                  <div class="rounded-2xl border border-edge px-4 py-3"><dt class="text-mute">Projetos</dt><dd class="mt-0.5 font-mono text-[12.5px]">{{ projects.devRoot() }}</dd></div>
                </dl>
                <button type="button" class="btn mt-4" (click)="dialogs.settings.set(false); dialogs.update.set(true)"><app-icon name="download" [size]="15" />Ver atualizações</button>
                <section class="mt-6 rounded-2xl border border-edge px-4 py-4" aria-labelledby="st-data">
                  <h3 id="st-data" class="font-semibold">Seus dados</h3>
                  <p class="mt-0.5 text-[13px] text-mute">Para usar a Central em outro computador (ex.: do Windows para o Mac): exporte aqui e importe lá. Vai tudo: projetos, backlog, ideias, decisões, agentes, memórias, rotinas e conversas. Importar substitui os dados de onde você importa (os de antes ficam como backup).</p>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button type="button" class="btn btn-sm" (click)="data.export()"><app-icon name="download" [size]="14" />Exportar…</button>
                    <button type="button" class="btn btn-sm" (click)="data.import()"><app-icon name="folder-open" [size]="14" />Importar…</button>
                  </div>
                  @if (data.message(); as m) { <p class="mt-2 text-[12.5px] text-yes selectable">{{ m }}</p> }
                  @if (data.error(); as e) { <p role="alert" class="mt-2 text-[12.5px] text-no">{{ e }}</p> }
                  <p class="mt-2 text-[12px] text-faint">Conversas mudam de computador sem a sessão do Claude (o histórico do Claude fica no computador de origem): as mensagens continuam, e a próxima resposta começa uma sessão nova. O WhatsApp precisa conectar o número de novo.</p>
                </section>
              }
            }
          </div>
        </div>
      </div>
    </dialog>`,
})
export class SettingsDialog {
  protected readonly dialogs = inject(DialogsService);
  protected readonly projects = inject(ProjectsService);
  protected readonly update = inject(UpdateService);
  private readonly api = inject(PrefsApiService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly options = OPTIONS;
  protected readonly tabs = TABS;
  protected readonly tab = signal<Tab>('general');
  protected readonly current = computed(() => TABS.find(t => t.id === this.tab())!);
  protected readonly usage = inject(UsageService);
  protected readonly prios = [{ i: 0, label: 'Alta' }, { i: 1, label: 'Normal' }, { i: 2, label: 'Baixa' }];
  protected setLimit(kind: 'session' | 'week', i: number, v: string): void {
    const l = structuredClone(this.usage.limits());
    l[kind][i] = Number(v);
    this.usage.saveLimits(l).catch(e => this.error.set(errorMessage(e)));
  }
  protected setPause(kind: 'session' | 'week', v: string): void {
    const l = structuredClone(this.usage.limits());
    l.pause[kind] = Number(v);
    this.usage.saveLimits(l).catch(e => this.error.set(errorMessage(e)));
  }
  protected readonly presets = PRESETS;
  /** preset que bate com os limites atuais (null = personalizado) */
  protected readonly preset = computed(() => PRESETS.find(p => JSON.stringify(p.limits) === JSON.stringify(this.usage.limits()))?.id ?? null);
  protected applyPreset(l: GovLimits): void { this.usage.saveLimits(structuredClone(l)).catch(e => this.error.set(errorMessage(e))); }
  protected readonly chat = inject(ChatPrefsService);
  protected readonly widths = CHAT_WIDTHS;
  protected readonly fontMin = FONT_MIN;
  protected readonly fontMax = FONT_MAX;
  protected readonly prefs = signal<Prefs | null>(null);
  /** pasta de dados (muda conforme o sistema) */
  protected readonly dataDir = signal('');
  protected readonly data = inject(DataTransferService);
  protected readonly error = signal<string | null>(null);

  constructor() {
    inject(IpcService).invoke('app:info').then(i => this.dataDir.set(i.data_dir ?? ''));
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
