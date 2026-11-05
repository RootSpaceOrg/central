import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

import { ExtensionDto, SttStatusDto, WaContactDto, WaStatusDto } from '../../../../shared/contract';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { SettingsApiService } from '../../../../shared/services/settings/settings-api.service';
import { IpcService, errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { AgentSelect } from '../../../../shared/components/pickers/agent-select';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';

const digits = (s: string) => s.replace(/\D/g, '');
/** +55 11 99999-8888 */
export function formatPhone(n: string): string {
  const d = digits(n);
  const m = /^(\d{2})(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : `+${d}`;
}

/**
 * Extensões: integrações instaláveis (o núcleo da Central não carrega o que você não usa). Cada uma roda num processo
 * próprio e é conferida pelo hash antes de rodar. Hoje: WhatsApp.
 */
@Component({
  selector: 'app-extensions-page',
  imports: [Icon, AgoPipe, AgentSelect, NgTemplateOutlet],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-[980px] px-10 pt-9 pb-16">
      <h1 class="flex items-center gap-3 font-display text-[32px] font-bold leading-tight tracking-tight"><app-icon name="puzzle" [size]="26" class="text-frost" />Extensões</h1>
      <p class="mt-1 max-w-2xl text-mute">Integrações que você instala quando precisa. Cada uma roda separada da Central: se cair, volta sozinha, e nada dela é carregado se não estiver instalada.</p>
      @if (error()) { <p role="alert" class="mt-5 rounded-2xl bg-no/10 px-5 py-3 text-no">{{ error() }}</p> }

      @for (e of list(); track e.id) {
        <section class="mt-7 rounded-3xl border border-edge bg-panel p-6" [attr.aria-labelledby]="'ext-' + e.id">
          <div class="flex flex-wrap items-start gap-4">
            <div class="min-w-0 flex-1">
              <h2 [id]="'ext-' + e.id" class="flex items-center gap-2 font-display text-xl font-semibold">{{ e.name }}
                <span class="rounded-full bg-raise px-2 py-0.5 text-[12px] font-normal text-mute">v{{ e.version }}</span>
                @if (e.installed) {
                  <span class="rounded-full px-2 py-0.5 text-[12px] font-semibold" [class]="!e.enabled ? 'bg-raise text-mute' : e.running ? 'bg-yes/15 text-yes' : 'bg-later/15 text-later'">{{ !e.enabled ? 'desabilitada' : e.running ? 'ligada' : 'parada' }}</span>
                }
              </h2>
              <p class="mt-1 text-[14px] leading-relaxed text-mute">{{ e.description }}</p>
              @if (e.warning) { <p class="mt-2 text-[13px] leading-relaxed text-later">{{ e.warning }}</p> }
            </div>
            @if (!e.installed) {
              <button type="button" class="btn btn-primary" (click)="install(e)" [disabled]="busy()"><app-icon name="download" [size]="15" />{{ busy() ? 'Instalando…' : 'Instalar' }}</button>
            } @else {
              <div class="flex gap-2">
                <button type="button" class="btn" (click)="enable(e, !e.enabled)" [disabled]="busy()"
                        [title]="e.enabled ? 'Para a extensão sem apagar nada (a sessão e os dados ficam para quando voltar)' : 'Liga de novo'">{{ e.enabled ? 'Desabilitar' : 'Habilitar' }}</button>
                <button type="button" class="btn btn-ghost !text-no" (click)="uninstall(e)" [disabled]="busy()">Desinstalar</button>
              </div>
            }
          </div>

          @if (e.installed && !e.enabled) {
            <p class="mt-5 border-t border-edge pt-4 text-[13.5px] text-mute">Desabilitada: não roda e não liga quando a Central abre. {{ e.id === 'whatsapp' ? 'Os números continuam vinculados e voltam ao habilitar.' : 'O que foi baixado continua aqui.' }}</p>
          }
          @if (e.id === 'whatsapp' && e.installed && e.enabled) {
            <div class="mt-6 border-t border-edge pt-5">
              <h3 class="font-semibold">Números conectados</h3>
              <p class="mt-0.5 text-[13px] text-mute">Cada número tem quem responde nele. Na conversa "você mesmo" de cada número, também responde o agente dele.</p>
              <div class="mt-3 space-y-3">
                @for (a of accounts(); track a.account) {
                  <div class="rounded-2xl border border-edge bg-night/60 p-4">
                    @switch (a.state) {
                      @case ('open') {
                        <div class="flex flex-wrap items-center gap-3">
                          <span class="size-2.5 rounded-full bg-yes"></span>
                          <span class="min-w-0 flex-1"><b class="font-mono">{{ fmt(a.me!.phone) }}</b>{{ a.me!.name ? ' · ' + a.me!.name : '' }}</span>
                          <span class="text-[13px] text-mute">Quem responde</span>
                          <app-agent-select class="w-60" [compact]="true" [value]="a.agent_id ? '' + a.agent_id : ''" (valueChange)="setAgent(a.account, $event)" noneLabel="A Central" />
                          <button type="button" class="btn btn-sm btn-ghost !text-no" (click)="logout(a.account)">Desconectar</button>
                        </div>
                        <label class="mt-3 flex cursor-pointer items-start gap-3 border-t border-edge pt-3">
                          <input type="checkbox" class="mt-1 accent-frost" [checked]="a.open" (change)="setOpen(a.account, $any($event.target).checked)">
                          <span><span class="block">Responder qualquer pessoa que escrever</span>
                            <span class="block text-[13px] text-mute">Atendimento: quem não é da casa também conversa com {{ agentName(a.agent_id) }} (até 20 mensagens por pessoa por hora). Desligado, só registra o contato.</span>
                            @if (a.open && !isRestricted(a.agent_id)) {
                              <span class="mt-1 block text-[13px] font-semibold text-no">{{ agentName(a.agent_id) }} não tem atuação restrita: qualquer pessoa estaria falando com um agente que mexe na Central. Ligue "Atuação restrita" no agente (aba Trabalho).</span>
                            }</span>
                        </label>
                      }
                      @case ('connecting') { <p class="flex items-center gap-2 text-mute"><span class="pulse size-2.5 rounded-full bg-later"></span>{{ a.me ? fmt(a.me.phone) + ': ' : '' }}reconectando…</p> }
                      @case ('pairing') {
                        @if (a.code) {
                          <p class="text-[14px] text-mute">No celular do número, abra o WhatsApp → <b class="text-text">Dispositivos conectados</b> → <b class="text-text">Conectar dispositivo</b> →
                            <b class="text-text">Conectar com número de telefone</b> e digite:</p>
                          <p class="mt-3 font-mono text-[34px] font-bold tracking-[0.25em] text-frost selectable" aria-live="polite">{{ a.code.slice(0, 4) }}-{{ a.code.slice(4) }}</p>
                          <p class="mt-2 flex items-center gap-3 text-[12.5px] text-faint">Fica válido por alguns minutos. Quando conectar, esta tela muda sozinha.
                            <button type="button" class="btn btn-sm btn-ghost ml-auto" (click)="logout(a.account)">Cancelar</button></p>
                        } @else { <p class="flex items-center gap-2 text-mute"><span class="pulse size-2.5 rounded-full bg-frost"></span>Pedindo o código ao WhatsApp…</p> }
                      }
                      @default {
                        <p class="flex items-center gap-2 text-mute"><span class="size-2.5 rounded-full bg-faint"></span>Desconectado
                          <button type="button" class="btn btn-sm btn-ghost ml-auto" (click)="logout(a.account)">Remover</button></p>
                      }
                    }
                  </div>
                }
              </div>

              @if (adding() || !accounts().length) {
                <form class="mt-3 flex flex-wrap items-end gap-3" (submit)="$event.preventDefault(); pair()">
                  <label class="min-w-64 flex-1"><span class="mb-1.5 block font-semibold">{{ accounts().length ? 'Outro número' : 'Número para conectar' }}</span>
                    <input class="field font-mono" inputmode="tel" autocomplete="off" placeholder="55 11 99999-8888" [value]="phone()" (input)="phone.set($any($event.target).value)"></label>
                  <button class="btn btn-primary" [disabled]="digits(phone()).length < 12 || busy()">Gerar código</button>
                  @if (accounts().length) { <button type="button" class="btn btn-ghost" (click)="adding.set(false)">Cancelar</button> }
                  <p class="w-full text-[12.5px] text-faint">Com DDI e DDD. Pode ser o seu número (você fala com o agente na conversa "você mesmo") ou um número só da Central, como o do atendimento.</p>
                </form>
              } @else {
                <button type="button" class="btn btn-sm mt-3" (click)="adding.set(true)"><app-icon name="plus" [size]="14" />Conectar outro número</button>
              }

              <h3 class="mt-7 font-semibold">Quem pode conversar com os agentes</h3>
              <p class="mt-0.5 text-[13px] text-mute">Estas pessoas falam com o agente de cada número, com tudo o que ele pode fazer. Os números conectados acima já contam (um pode falar com o outro). Mensagens de outros números ficam registradas abaixo e não acionam agente.</p>
              <div class="mt-3 flex flex-wrap gap-2">
                @for (a of accounts(); track a.account) { @if (a.me) { <span class="rounded-full bg-frost/12 px-3 py-1 text-[13px] text-frost">Você mesmo ({{ fmt(a.me.phone) }})</span> } }
                @for (o of owners(); track o) {
                  <span class="flex items-center gap-1.5 rounded-full bg-raise px-3 py-1 font-mono text-[13px]">{{ fmt(o) }}
                    <button type="button" (click)="removeOwner(o)" [attr.aria-label]="'Remover ' + fmt(o)" class="text-faint hover:text-no"><app-icon name="close" [size]="12" /></button></span>
                }
                <form class="flex gap-1.5" (submit)="$event.preventDefault(); addOwner()">
                  <input class="field !w-48 !py-1 font-mono text-[13px]" inputmode="tel" placeholder="+ número" aria-label="Adicionar número" [value]="ownerInput()" (input)="ownerInput.set($any($event.target).value)">
                  <button class="btn btn-sm" [disabled]="digits(ownerInput()).length < 12">Adicionar</button>
                </form>
              </div>

              <h3 class="mt-7 font-semibold">Agentes mandando mensagem</h3>
              <label class="mt-2 flex cursor-pointer items-start gap-3">
                <input type="checkbox" class="mt-1 accent-frost" [checked]="any()" (change)="setAny($any($event.target).checked)">
                <span><span class="block">Podem mandar para qualquer número sem me perguntar</span>
                  <span class="block text-[13px] text-mute">Desligado, a primeira mensagem para quem nunca falou com vocês vira uma decisão na Triagem. Ligar aumenta o risco de bloqueio do número.</span></span>
              </label>
              <label class="mt-3 flex cursor-pointer items-start gap-3">
                <input type="checkbox" class="mt-1 accent-frost" [checked]="notifyOn()" (change)="setNotify($any($event.target).checked)">
                <span><span class="block">Avisar pelo WhatsApp quando um agente parar esperando por mim</span>
                  <span class="block text-[13px] text-mute">Vai para os números acima (ou para você mesmo).</span></span>
              </label>

              @if (contacts().length) {
                <h3 class="mt-7 font-semibold">Contatos recentes</h3>
                <ul class="mt-2 divide-y divide-edge rounded-2xl border border-edge">
                  @for (c of contacts(); track c.phone) {
                    <li class="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
                      <span class="w-44 shrink-0 font-mono">{{ fmt(c.phone) }}</span>
                      <span class="min-w-0 flex-1 truncate text-mute">{{ c.name ? c.name + ': ' : '' }}{{ c.last_text ?? '(só mensagens enviadas)' }}</span>
                      <span class="shrink-0 text-[12px] text-faint">{{ when(c) | ago }}</span>
                      <button type="button" class="grid size-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-raise hover:text-text" (click)="copy(c.phone)"
                              [title]="copied() === c.phone ? 'Copiado' : 'Copiar número'" [attr.aria-label]="'Copiar ' + fmt(c.phone)">
                        <app-icon [name]="copied() === c.phone ? 'check' : 'copy'" [size]="14" [class.text-yes]="copied() === c.phone" /></button>
                      @if (owners().includes(c.phone)) {
                        <button type="button" class="btn btn-sm btn-ghost shrink-0 !text-no" (click)="removeOwner(c.phone)" title="Tira da lista de quem pode conversar com os agentes">
                          <app-icon name="close" [size]="13" />Remover</button>
                      } @else {
                        <button type="button" class="btn btn-sm shrink-0" (click)="addOwnerNumber(c.phone)" title="Pode conversar com os agentes (como você)">
                          <app-icon name="plus" [size]="13" />Adicionar</button>
                      }
                    </li>
                  }
                </ul>
              }
            </div>
          }
          @if (e.id === 'transcricao' && e.installed && e.enabled) {
            @let t = stt();
            <div class="mt-6 space-y-6 border-t border-edge pt-5">
              <div>
                <h3 class="font-semibold">Motor</h3>
                <div class="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Motor de transcrição">
                  @for (o of engines; track o.id) {
                    <button type="button" role="radio" [attr.aria-checked]="t?.engine === o.id" (click)="config({ engine: o.id })"
                            class="rounded-2xl border px-4 py-3 text-left" [class]="t?.engine === o.id ? 'border-frost/60 bg-frost/10' : 'border-edge bg-night hover:border-faint'">
                      <span class="block font-semibold">{{ o.label }}</span><span class="mt-0.5 block text-[12.5px] text-mute">{{ o.hint }}</span></button>
                  }
                </div>
              </div>

              @if (t?.engine === 'local') {
                <div>
                  <h3 class="font-semibold">Motor local</h3>
                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    <span class="text-[13px] text-mute">Modelo</span>
                    @for (m of models; track m.id) {
                      <button type="button" class="btn btn-sm" [class.!border-frost]="t?.model === m.id" [class.!text-frost]="t?.model === m.id" (click)="config({ model: m.id })">{{ m.label }}
                        @if (t?.ext?.models?.[m.id]) { <app-icon name="check" [size]="13" class="text-yes" /> }</button>
                    }
                    <span class="flex-1"></span>
                    @if (localReady()) { <span class="flex items-center gap-1.5 text-[13px] text-yes"><app-icon name="check" [size]="14" />Pronto</span> }
                    @else if (!downloading()) { <button type="button" class="btn btn-sm btn-primary" (click)="prepare()"><app-icon name="download" [size]="14" />Preparar ({{ prepareSize() }})</button> }
                  </div>
                  <ng-container *ngTemplateOutlet="bar" />
                  <p class="mt-2 text-[12.5px] text-faint">Roda no seu PC, sem nuvem e sem gastar a cota do Claude. O ffmpeg baixado aqui também serve para vídeo (quadros + fala).</p>
                </div>
              } @else {
                <div>
                  <h3 class="font-semibold">OpenAI</h3>
                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    @if (t?.hasKey) {
                      <span class="flex items-center gap-1.5 rounded-full bg-yes/12 px-3 py-1 text-[13px] text-yes"><app-icon name="check" [size]="13" />Chave guardada (criptografada pelo Windows)</span>
                      <button type="button" class="btn btn-sm btn-ghost !text-no" (click)="config({ key: null })">Remover</button>
                    } @else {
                      <input class="field !w-80 font-mono text-[13px]" type="password" autocomplete="off" placeholder="sk-..." aria-label="Chave da OpenAI" [value]="keyInput()" (input)="keyInput.set($any($event.target).value)">
                      <button type="button" class="btn btn-sm" [disabled]="keyInput().trim().length < 20" (click)="saveKey()">Guardar chave</button>
                    }
                    <span class="flex-1"></span>
                    <span class="text-[13px] text-mute">Modelo</span>
                    <select class="field !w-56 !py-1 text-[13px]" aria-label="Modelo da OpenAI" (change)="config({ openaiModel: $any($event.target).value })">
                      @for (m of openaiModels; track m) { <option [value]="m" [selected]="t?.openaiModel === m">{{ m }}</option> }
                    </select>
                  </div>
                  <p class="mt-2 text-[12.5px] text-faint">Cobrado na sua conta da OpenAI por áudio transcrito. A chave só sai do seu PC para a própria OpenAI.</p>
                  <div class="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-edge px-3 py-2.5 text-[13px]">
                    <span class="flex-1 text-mute">Vídeo (quadros + fala) usa o ffmpeg no seu PC, com qualquer motor.</span>
                    @if (t?.ext?.ffmpeg) { <span class="flex items-center gap-1.5 text-yes"><app-icon name="check" [size]="14" />Pronto para vídeo</span> }
                    @else if (!downloading()) { <button type="button" class="btn btn-sm" (click)="prepare()"><app-icon name="download" [size]="14" />Preparar para vídeo (ffmpeg, 34 MB)</button> }
                  </div>
                  <ng-container *ngTemplateOutlet="bar" />
                </div>
              }
              <ng-template #bar>
                @if (downloading()) {
                  @let p = t?.ext?.progress;
                  <div class="mt-3">
                    <p class="text-[12.5px] text-mute">{{ p ? 'Baixando ' + (assetLabel[p.name] ?? p.name) + ': ' + mb(p.done) + ' de ' + mb(p.total) + ' MB' : 'Começando…' }}</p>
                    <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-raise">
                      <div class="h-full rounded-full bg-frost transition-all" [class.animate-pulse]="!p" [style.width.%]="p ? (p.done / p.total) * 100 : 4"></div></div>
                  </div>
                }
                @if (t?.ext?.error) { <p class="mt-2 text-[13px] text-no">{{ t!.ext!.error }}</p> }
              </ng-template>
            </div>
          }
        </section>
      }
    </div>
  `,
})
export class ExtensionsPage {
  private readonly ipc = inject(IpcService);
  private readonly settings = inject(SettingsApiService);
  private readonly agents = inject(AgentsService);

  protected readonly list = signal<ExtensionDto[]>([]);
  protected readonly wa = signal<WaStatusDto | null>(null);
  protected readonly stt = signal<SttStatusDto | null>(null);
  protected readonly keyInput = signal('');
  protected readonly engines = [
    { id: 'local' as const, label: 'Local (Whisper)', hint: 'No seu PC, grátis. Precisa preparar uma vez.' },
    { id: 'openai' as const, label: 'OpenAI', hint: 'Na nuvem, com a sua chave. Mais preciso em áudio ruim.' },
  ];
  protected readonly models = [{ id: 'small' as const, label: 'Melhor (small, 488 MB)' }, { id: 'base' as const, label: 'Rápido (base, 148 MB)' }];
  protected readonly openaiModels = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'];
  protected readonly assetLabel: Record<string, string> = { whisper: 'o Whisper', ffmpeg: 'o ffmpeg', small: 'o modelo small', base: 'o modelo base' };
  protected readonly mb = (n: number) => Math.round(n / 1_048_576);
  protected readonly localReady = computed(() => { const t = this.stt(); return !!t?.ext?.whisper && !!t.ext.ffmpeg && !!t.ext.models[t.model]; });
  protected readonly prepareSize = computed(() => {
    const t = this.stt(); if (!t) return '';
    const mb = (t.ext?.whisper ? 0 : 9) + (t.ext?.ffmpeg ? 0 : 34) + (t.ext?.models[t.model] ? 0 : t.model === 'small' ? 465 : 141);
    return `${mb} MB`;
  });
  protected readonly accounts = computed(() => this.wa()?.accounts ?? []);
  protected readonly adding = signal(false);
  protected readonly contacts = signal<WaContactDto[]>([]);
  protected readonly owners = signal<string[]>([]);
  protected readonly any = signal(false);
  protected readonly notifyOn = signal(true);
  protected readonly phone = signal('');
  protected readonly ownerInput = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly digits = digits;
  protected readonly fmt = formatPhone;
  protected readonly when = (c: WaContactDto) => new Date(c.last_in_at ?? c.last_out_at ?? Date.now());
  private readonly waInstalled = computed(() => !!this.list().find(e => e.id === 'whatsapp')?.installed);

  constructor() {
    this.load();
    const off = this.ipc.on('ext:changed', () => this.load());
    inject(DestroyRef).onDestroy(off);
    this.settings.get('wa:owners').then(v => this.owners.set(v ? JSON.parse(v) : []));
    this.settings.get('wa:any').then(v => this.any.set(v === '1'));
    this.settings.get('wa:notify').then(v => this.notifyOn.set(v !== '0'));
  }

  private async load(): Promise<void> {
    this.list.set(await this.ipc.invoke('ext:list'));
    if (this.list().find(e => e.id === 'transcricao')?.installed) this.stt.set(await this.ipc.invoke('stt:status'));
    if (this.waInstalled()) {
      this.wa.set(await this.ipc.invoke('wa:status'));
      this.contacts.set(await this.ipc.invoke('wa:contacts'));
    }
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try { await fn(); await this.load(); } catch (e) { this.error.set(errorMessage(e)); } finally { this.busy.set(false); }
  }

  protected install(e: ExtensionDto): void { this.run(() => this.ipc.invoke('ext:install', e.id)); }
  protected uninstall(e: ExtensionDto): void { this.run(() => this.ipc.invoke('ext:uninstall', e.id)); }
  protected pair(): void { this.run(async () => { await this.ipc.invoke('wa:pair', null, digits(this.phone())); this.phone.set(''); this.adding.set(false); }); }
  protected logout(account: string): void { this.run(() => this.ipc.invoke('wa:logout', account)); }
  protected config(patch: { engine?: 'local' | 'openai'; model?: 'small' | 'base'; openaiModel?: string; key?: string | null }): void { this.run(() => this.ipc.invoke('stt:config', patch)); }
  protected saveKey(): void { const k = this.keyInput().trim(); this.keyInput.set(''); this.config({ key: k }); }
  // a preparação baixa centenas de MB: não prende a tela; o progresso chega pelo status
  /** clicou em Preparar: a barra aparece na hora (o primeiro aviso de progresso da extensão leva uns segundos) */
  protected readonly preparing = signal(false);
  protected readonly downloading = computed(() => this.preparing() || !!this.stt()?.ext?.progress);
  protected prepare(): void {
    this.error.set(null);
    this.preparing.set(true);
    this.ipc.invoke('stt:prepare').catch(e => this.error.set(errorMessage(e))).finally(() => { this.preparing.set(false); this.load(); });
  }
  protected setOpen(account: string, on: boolean): void { this.run(() => this.ipc.invoke('wa:setOpen', account, on)); }
  protected agentName(id: number | null): string { return id ? this.agents.byId().get(id)?.name ?? 'o agente' : 'a Central'; }
  protected isRestricted(id: number | null): boolean { return !!id && !!this.agents.byId().get(id)?.restricted; }
  protected setAgent(account: string, id: string): void { this.run(() => this.ipc.invoke('wa:setAgent', account, Number(id) || null)); }

  private saveOwners(list: string[]): void {
    this.owners.set(list);
    this.settings.set('wa:owners', JSON.stringify(list));
  }
  protected addOwner(): void {
    const n = digits(this.ownerInput());
    if (n.length >= 12 && !this.owners().includes(n)) this.saveOwners([...this.owners(), n]);
    this.ownerInput.set('');
  }
  protected addOwnerNumber(n: string): void { if (!this.owners().includes(n)) this.saveOwners([...this.owners(), n]); }
  protected readonly copied = signal<string | null>(null);
  protected copy(n: string): void {
    this.ipc.invoke('app:copy', n).then(() => { this.copied.set(n); setTimeout(() => { if (this.copied() === n) this.copied.set(null); }, 1500); });
  }
  protected enable(e: ExtensionDto, on: boolean): void { this.run(() => this.ipc.invoke('ext:enable', e.id, on)); }
  protected removeOwner(n: string): void { this.saveOwners(this.owners().filter(x => x !== n)); }
  protected setAny(v: boolean): void { this.any.set(v); this.settings.set('wa:any', v ? '1' : '0'); }
  protected setNotify(v: boolean): void { this.notifyOn.set(v); this.settings.set('wa:notify', v ? '1' : '0'); }
}
