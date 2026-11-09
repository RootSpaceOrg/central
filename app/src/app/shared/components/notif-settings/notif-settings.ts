import { Component, inject, signal } from '@angular/core';

import { NotifLevel, NotifPrefsDto } from '../../contract';
import { IpcService, errorMessage } from '../../services/ipc/ipc.service';
import { NotifSoundService } from '../../services/notif-sound/notif-sound.service';
import { Icon } from '../../ui/icon';
import { Select, SelectOption } from '../../ui/select';
import { Switch } from '../../ui/switch';

const LEVELS: { id: NotifLevel; label: string }[] = [{ id: 'all', label: 'Sempre' }, { id: 'failed', label: 'Só se falhar' }, { id: 'none', label: 'Nunca' }];

/** Preferências → Notificações: o que gera aviso no Windows/Mac, o som e o não perturbe. */
@Component({
  selector: 'app-notif-settings',
  imports: [Icon, Select, Switch],
  host: { class: 'block' },
  template: `
    @if (p(); as n) {
      <section class="rounded-2xl border border-edge px-4 py-4">
        <h4 class="font-semibold">Quando terminar</h4>
        <div class="mt-3 space-y-3">
          @for (row of rows; track row.key) {
            <div class="flex flex-wrap items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="text-[13.5px] font-semibold">{{ row.label }}</p>
                <p class="text-[12px] text-mute">{{ row.hint }}</p>
              </div>
              <div class="flex gap-1 rounded-full border border-edge bg-night p-1" role="radiogroup" [attr.aria-label]="row.label">
                @for (l of levels; track l.id) {
                  <button type="button" role="radio" [attr.aria-checked]="n[row.key] === l.id" (click)="setLevel(row.key, l.id)"
                          class="rounded-full px-3 py-1 text-[12.5px] font-semibold" [class]="n[row.key] === l.id ? 'bg-raise text-text' : 'text-mute hover:text-text'">{{ l.label }}</button>
                }
              </div>
            </div>
          }
        </div>
      </section>

      <section class="mt-4 space-y-3 rounded-2xl border border-edge px-4 py-4">
        <h4 class="font-semibold">Outros avisos</h4>
        <app-switch [checked]="n.idle" (changed)="set({ idle: $event })" label="Tudo terminou"
                    hint="Uma vez, quando não sobra nada rodando nem esperando na fila (com quantas terminaram e quantas falharam)." />
        <app-switch [checked]="n.waiting" (changed)="set({ waiting: $event })" label="Agente esperando você" hint="Parou pedindo algo seu: login, acesso, uma resposta." />
        <app-switch [checked]="n.ci" (changed)="set({ ci: $event })" label="CI quebrado" hint="GitHub Actions falhando em algum repositório." />
      </section>

      <section class="mt-4 rounded-2xl border border-edge px-4 py-4">
        <h4 class="font-semibold">Som e horário</h4>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <span class="w-28 text-[13px] text-mute">Som</span>
          <app-select class="w-56" [compact]="true" [options]="sounds" [value]="n.sound" (valueChange)="setSound($event)" label="Som" [minWidth]="220" />
          <button type="button" class="btn btn-sm" (click)="test()"><app-icon name="play" [size]="13" />Testar</button>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <span class="w-28 text-mute">Não perturbe</span>
          <label class="flex cursor-pointer items-center gap-2"><input type="checkbox" class="accent-frost" [checked]="!!n.quiet" (change)="set({ quiet: $any($event.target).checked ? '22-07' : '' })">{{ n.quiet ? 'Ligado' : 'Desligado' }}</label>
          @if (n.quiet) {
            <span>das</span><input type="number" min="0" max="23" class="field !w-16 !py-1 text-center" aria-label="Começa às" [value]="quietFrom()" (change)="setQuiet($any($event.target).value, quietTo())">
            <span>às</span><input type="number" min="0" max="23" class="field !w-16 !py-1 text-center" aria-label="Termina às" [value]="quietTo()" (change)="setQuiet(quietFrom(), $any($event.target).value)">
            <span class="text-faint">h (nada avisa nesse horário)</span>
          }
        </div>
      </section>
      @if (error()) { <p role="alert" class="mt-3 text-[13px] text-no">{{ error() }}</p> }
    }
  `,
})
export class NotifSettings {
  private readonly ipc = inject(IpcService);
  private readonly player = inject(NotifSoundService);

  protected readonly p = signal<NotifPrefsDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly levels = LEVELS;
  protected readonly rows: { key: 'agents' | 'boards' | 'routines'; label: string; hint: string }[] = [
    { key: 'agents', label: 'Execução de agente', hint: 'Tarefas e trabalhos que você ou outro agente mandou.' },
    { key: 'boards', label: 'Etapa de quadro', hint: 'Cada coluna de cada cartão (ex.: Produção → Revisão). Costuma ser muito aviso.' },
    { key: 'routines', label: 'Rotina', hint: 'Rotinas com agente e rotinas de comando.' },
  ];
  protected readonly sounds: SelectOption[] = [
    { value: 'system', label: 'Padrão do sistema' }, { value: 'none', label: 'Sem som' }, { value: 'chime', label: 'Sino duplo' },
    { value: 'drop', label: 'Gota' }, { value: 'pop', label: 'Pop' }, { value: 'bell', label: 'Campainha' },
  ];

  constructor() { this.ipc.invoke('notif:get').then(p => this.p.set(p)); }

  protected quietFrom(): number { return Number(this.p()?.quiet.split('-')[0] ?? 22); }
  protected quietTo(): number { return Number(this.p()?.quiet.split('-')[1] ?? 7); }

  protected set(patch: Partial<NotifPrefsDto>): void {
    const cur = this.p();
    if (cur) this.p.set({ ...cur, ...patch });
    this.ipc.invoke('notif:set', patch).then(p => this.p.set(p), e => this.error.set(errorMessage(e)));
  }
  protected setLevel(key: 'agents' | 'boards' | 'routines', level: NotifLevel): void { this.set({ [key]: level }); }
  protected setSound(s: string): void {
    this.set({ sound: s as NotifPrefsDto['sound'] });
    this.player.play(s);
  }
  protected setQuiet(a: number | string, b: number | string): void {
    const h = (v: number | string) => Math.max(0, Math.min(23, Math.round(Number(v) || 0)));
    this.set({ quiet: `${h(a)}-${h(b)}` });
  }
  protected test(): void { this.ipc.invoke('notif:test').catch(e => this.error.set(errorMessage(e))); }
}
