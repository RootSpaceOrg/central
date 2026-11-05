import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

import { WaChatCfg, WaChatDto, WaContactDto, WaStatusDto } from '../../../../../../shared/contract';
import { AgentSelect } from '../../../../../../shared/components/pickers/agent-select';
import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { IpcService, errorMessage } from '../../../../../../shared/services/ipc/ipc.service';
import { SettingsApiService } from '../../../../../../shared/services/settings/settings-api.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { Select, SelectOption } from '../../../../../../shared/ui/select';
import { Switch } from '../../../../../../shared/ui/switch';

const digits = (s: string) => s.replace(/\D/g, '');
/** +55 11 99999-8888 */
export function formatPhone(n: string): string {
  const d = digits(n);
  const m = /^(\d{2})(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : `+${d}`;
}

type Tab = 'numbers' | 'chats' | 'people' | 'replies';

/** Configuração do WhatsApp: números (e quem responde em cada), conversas, quem fala com os agentes e o jeito de responder. */
@Component({
  selector: 'app-whatsapp-config',
  imports: [Icon, AgoPipe, AgentSelect, Switch, Select],
  host: { class: 'block' },
  template: `
    <nav class="flex gap-1 border-b border-edge" role="tablist" aria-label="Configuração do WhatsApp">
      @for (t of tabs(); track t.id) {
        <button type="button" role="tab" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)"
                class="-mb-px flex items-center gap-2 border-b-2 px-4 pb-3 text-[14.5px] font-semibold transition-colors"
                [class]="tab() === t.id ? 'border-[#25D366] text-text' : 'border-transparent text-mute hover:text-text'">
          {{ t.label }}@if (t.n !== null) { <span class="rounded-full bg-raise px-2 text-[12px] font-normal tabular-nums text-mute">{{ t.n }}</span> }
        </button>
      }
    </nav>
    @if (error()) { <p role="alert" class="mt-5 rounded-2xl bg-no/10 px-5 py-3 text-no">{{ error() }}</p> }

    @switch (tab()) {
      @case ('numbers') {
        <p class="mt-5 text-[13.5px] text-mute">Cada número tem quem responde nele. Na conversa "você mesmo" de cada número, também responde o agente dele.</p>
        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          @for (a of accounts(); track a.account) {
            <article class="rounded-3xl border border-edge bg-panel p-5">
              @switch (a.state) {
                @case ('open') {
                  <div class="flex items-center gap-3">
                    <span class="grid size-11 place-items-center rounded-full bg-[#25D366]/15 text-[#25D366]"><app-icon name="message" [size]="20" /></span>
                    <div class="min-w-0 flex-1">
                      <p class="font-mono text-[15px] font-semibold">{{ fmt(a.me!.phone) }}</p>
                      <p class="flex items-center gap-1.5 text-[12.5px] text-yes"><span class="size-1.5 rounded-full bg-yes"></span>Conectado{{ a.me!.name ? ' · ' + a.me!.name : '' }}</p>
                    </div>
                    <button type="button" class="btn btn-sm btn-ghost !text-no" (click)="logout(a.account)">Desconectar</button>
                  </div>
                  <label class="mt-5 block text-[13px] font-semibold text-mute">Quem responde neste número</label>
                  <app-agent-select class="mt-1.5 block" [value]="a.agent_id ? '' + a.agent_id : ''" (valueChange)="setAgent(a.account, $event)" noneLabel="A Central" />
                  <div class="mt-4 border-t border-edge pt-4">
                    <app-switch [checked]="a.open" (changed)="setOpen(a.account, $event)" label="Responder qualquer pessoa"
                                [hint]="'Atendimento: quem não é da casa também conversa com ' + agentName(a.agent_id) + ' (com o limite por hora da aba Como responder). Desligado, só registra o contato.'" />
                    @if (a.open && !isRestricted(a.agent_id)) {
                      <p class="mt-2 rounded-xl bg-no/10 px-3 py-2 text-[13px] text-no">{{ agentName(a.agent_id) }} não tem atuação restrita: qualquer pessoa estaria falando com um agente que mexe na Central. Ligue "Atuação restrita" no agente (aba Trabalho).</p>
                    }
                  </div>
                }
                @case ('connecting') { <p class="flex items-center gap-2 text-mute"><span class="pulse size-2.5 rounded-full bg-later"></span>{{ a.me ? fmt(a.me.phone) + ': ' : '' }}reconectando…</p> }
                @case ('pairing') {
                  @if (a.code) {
                    <p class="text-[14px] leading-relaxed text-mute">No celular do número, abra o WhatsApp → <b class="text-text">Dispositivos conectados</b> → <b class="text-text">Conectar dispositivo</b> →
                      <b class="text-text">Conectar com número de telefone</b> e digite:</p>
                    <p class="mt-4 text-center font-mono text-[36px] font-bold tracking-[0.25em] text-[#25D366] selectable" aria-live="polite">{{ a.code.slice(0, 4) }}-{{ a.code.slice(4) }}</p>
                    <p class="mt-3 flex items-center gap-3 text-[12.5px] text-faint">Vale por alguns minutos. Quando conectar, isto muda sozinho.
                      <button type="button" class="btn btn-sm btn-ghost ml-auto" (click)="logout(a.account)">Cancelar</button></p>
                  } @else { <p class="flex items-center gap-2 text-mute"><span class="pulse size-2.5 rounded-full bg-frost"></span>Pedindo o código ao WhatsApp…</p> }
                }
                @default {
                  <p class="flex items-center gap-2 text-mute"><span class="size-2.5 rounded-full bg-faint"></span>Desconectado
                    <button type="button" class="btn btn-sm btn-ghost ml-auto" (click)="logout(a.account)">Remover</button></p>
                }
              }
            </article>
          }
          <!-- conectar outro -->
          <article class="rounded-3xl border-2 border-dashed border-edge p-5">
            <form (submit)="$event.preventDefault(); pair()">
              <p class="flex items-center gap-2 font-semibold"><app-icon name="plus" [size]="16" />{{ accounts().length ? 'Conectar outro número' : 'Conectar um número' }}</p>
              <input class="field mt-3 font-mono" inputmode="tel" autocomplete="off" placeholder="55 11 99999-8888" aria-label="Número com DDI e DDD" [value]="phone()" (input)="phone.set($any($event.target).value)">
              <p class="mt-2 text-[12.5px] leading-relaxed text-faint">Com DDI e DDD. Pode ser o seu número (você fala com o agente na conversa "você mesmo") ou um número só da Central, como o do atendimento.</p>
              <button class="btn btn-primary mt-3" [disabled]="digits(phone()).length < 12 || busy()">Gerar código</button>
            </form>
          </article>
        </div>
      }

      @case ('chats') {
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl border border-edge bg-panel px-4 py-3 text-[13px]"><p class="font-semibold text-text">Responder</p><p class="mt-0.5 text-mute">Quem responde nesta conversa (ou ninguém), por cima do padrão do número.</p></div>
          <div class="rounded-2xl border border-edge bg-panel px-4 py-3 text-[13px]"><p class="font-semibold text-text">Escutar</p><p class="mt-0.5 text-mute">Um agente lê os trechos e registra o que impacta os projetos como ideias ou decisões.</p></div>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <app-select class="w-96" [action]="true" [options]="chatOptions()" search="always" (opened)="loadGroups()" (picked)="addChat($event)"
                      placeholder="Configurar um grupo ou contato…" label="Configurar uma conversa" searchPlaceholder="Buscar grupo ou contato…"
                      [emptyLabel]="loadingGroups() ? 'Carregando grupos…' : 'Nenhum grupo ou contato novo.'" [minWidth]="380" />
          <span class="flex items-center gap-2 text-[13px] text-mute">A escuta lê depois de
            <input type="number" min="1" max="240" class="field !w-16 !py-1 text-center" aria-label="Minutos de conversa antes de ler" [value]="listenDelay()" (change)="setListenDelay($any($event.target).value)">
            min de conversa</span>
        </div>
        <div class="mt-4 space-y-3">
          @for (c of chats(); track c.account + c.chat) {
            <article class="rounded-3xl border border-edge bg-panel p-5">
              <div class="flex items-center gap-3">
                <span class="grid size-9 place-items-center rounded-full text-[12px] font-semibold" [class]="c.group ? 'bg-frost/15 text-frost' : 'bg-raise text-mute'">{{ c.group ? 'G' : 'C' }}</span>
                <div class="min-w-0 flex-1"><p class="truncate font-semibold">{{ c.name }}</p><p class="text-[12px] text-faint">{{ c.group ? 'grupo' : 'contato' }}</p></div>
                <button type="button" class="grid size-8 place-items-center rounded-lg text-faint hover:bg-raise hover:text-no" (click)="removeChat(c)" [attr.aria-label]="'Tirar ' + c.name + ' da lista'" title="Tirar da lista (volta ao padrão do número)"><app-icon name="close" [size]="15" /></button>
              </div>
              <div class="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <p class="text-[13px] font-semibold text-mute">Responder</p>
                  <div class="mt-1.5 flex rounded-xl border border-edge p-0.5" role="radiogroup" [attr.aria-label]="'Responder em ' + c.name">
                    @for (o of replyOptions(c); track o.id) {
                      <button type="button" role="radio" [attr.aria-checked]="c.reply === o.id" (click)="patchChat(c, { reply: o.id })"
                              class="flex-1 rounded-lg px-2.5 py-1.5 text-[13px]" [class]="c.reply === o.id ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-text'">{{ o.label }}</button>
                    }
                  </div>
                  @if (c.reply === 'on') {
                    <app-agent-select class="mt-2 block" [compact]="true" [value]="c.reply_agent ? '' + c.reply_agent : ''" (valueChange)="patchChat(c, { reply_agent: num($event) })" noneLabel="O agente do número" />
                    @if (!isRestricted(c.reply_agent ?? accountAgent(c.account))) {
                      <p class="mt-1.5 text-[12px] text-no">{{ agentName(c.reply_agent ?? accountAgent(c.account)) }} não tem atuação restrita: {{ c.group ? 'quem está no grupo' : 'essa pessoa' }} falaria com um agente que mexe na Central.</p>
                    }
                  } @else {
                    <p class="mt-1.5 text-[12px] text-faint">{{ c.reply === 'off' ? 'Ninguém responde nesta conversa.' : c.group ? 'Grupos não têm resposta por padrão.' : 'Segue o padrão do número.' }}</p>
                  }
                  @if (c.reply !== 'off' && !(c.group && c.reply === 'inherit')) {
                    <div class="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-mute">
                      <span>Limite por pessoa</span>
                      <input type="number" min="0" max="1000" class="field !w-20 !py-1 text-center" [placeholder]="'' + perHour()" [value]="c.per_hour ?? ''"
                             (change)="setChatLimit(c, $any($event.target).value)" [attr.aria-label]="'Mensagens por pessoa por hora em ' + c.name">
                      <span>por hora</span>
                      <span class="text-faint">{{ c.per_hour === null || c.per_hour === undefined ? '(padrão: ' + (perHour() || 'sem limite') + ')' : c.per_hour === 0 ? '(sem limite)' : '' }}</span>
                    </div>
                  }
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <p class="flex-1 text-[13px] font-semibold text-mute">Escutar</p>
                    @if (c.listen) { <button type="button" class="btn btn-sm" [disabled]="!c.pending" (click)="digestNow(c)" title="Ler agora o que acumulou">Ler agora</button> }
                  </div>
                  <app-switch class="mt-1" [checked]="c.listen" (changed)="patchChat(c, { listen: $event })" [label]="c.listen ? 'Escutando' : 'Desligado'"
                              [hint]="c.listen ? (c.pending ? c.pending + (c.pending === 1 ? ' mensagem esperando leitura' : ' mensagens esperando leitura') : 'Nada novo para ler.') : ''" />
                  @if (c.listen) {
                    <app-agent-select class="mt-2 block" [compact]="true" [value]="c.listen_agent ? '' + c.listen_agent : ''" (valueChange)="patchChat(c, { listen_agent: num($event) })" noneLabel="Quem lê: a Central" />
                  }
                </div>
              </div>
            </article>
          } @empty {
            <p class="rounded-3xl border-2 border-dashed border-edge p-10 text-center text-[13.5px] text-mute">Nenhuma conversa configurada: vale o padrão de cada número.</p>
          }
        </div>
      }

      @case ('people') {
        <section class="mt-5 rounded-3xl border border-edge bg-panel p-5">
          <h3 class="font-semibold">Quem pode conversar com os agentes</h3>
          <p class="mt-0.5 text-[13px] leading-relaxed text-mute">Falam com o agente de cada número, com tudo o que ele pode fazer. Os números conectados já contam. Mensagens de outros números ficam registradas e não acionam agente (a não ser no atendimento).</p>
          <div class="mt-4 flex flex-wrap gap-2">
            @for (a of accounts(); track a.account) { @if (a.me) { <span class="rounded-full bg-frost/12 px-3 py-1 text-[13px] text-frost">Você mesmo ({{ fmt(a.me.phone) }})</span> } }
            @for (o of owners(); track o) {
              <span class="flex items-center gap-1.5 rounded-full bg-raise px-3 py-1 font-mono text-[13px]">{{ fmt(o) }}
                <button type="button" (click)="removeOwner(o)" [attr.aria-label]="'Remover ' + fmt(o)" class="text-faint hover:text-no"><app-icon name="close" [size]="12" /></button></span>
            }
          </div>
          <form class="mt-3 flex gap-2" (submit)="$event.preventDefault(); addOwner()">
            <input class="field !w-60 !py-1.5 font-mono text-[13px]" inputmode="tel" placeholder="55 11 99999-8888" aria-label="Adicionar número" [value]="ownerInput()" (input)="ownerInput.set($any($event.target).value)">
            <button class="btn btn-sm" [disabled]="digits(ownerInput()).length < 12"><app-icon name="plus" [size]="13" />Adicionar</button>
          </form>
        </section>
        <section class="mt-4 rounded-3xl border border-edge bg-panel p-5">
          <h3 class="font-semibold">Contatos recentes</h3>
          @if (contacts().length) {
            <ul class="mt-3 divide-y divide-edge">
              @for (c of contacts(); track c.phone) {
                <li class="flex items-center gap-3 py-2.5 text-[13.5px]">
                  <span class="w-44 shrink-0 font-mono">{{ fmt(c.phone) }}</span>
                  <span class="min-w-0 flex-1 truncate text-mute">{{ c.name ? c.name + ': ' : '' }}{{ c.last_text ?? '(só mensagens enviadas)' }}</span>
                  <span class="shrink-0 text-[12px] text-faint">{{ when(c) | ago }}</span>
                  <button type="button" class="grid size-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-raise hover:text-text" (click)="copy(c.phone)"
                          [title]="copied() === c.phone ? 'Copiado' : 'Copiar número'" [attr.aria-label]="'Copiar ' + fmt(c.phone)">
                    <app-icon [name]="copied() === c.phone ? 'check' : 'copy'" [size]="14" [class.text-yes]="copied() === c.phone" /></button>
                  @if (owners().includes(c.phone)) {
                    <button type="button" class="btn btn-sm btn-ghost shrink-0 !text-no" (click)="removeOwner(c.phone)" title="Tira da lista de quem pode conversar com os agentes"><app-icon name="close" [size]="13" />Remover</button>
                  } @else {
                    <button type="button" class="btn btn-sm shrink-0" (click)="addOwnerNumber(c.phone)" title="Pode conversar com os agentes (como você)"><app-icon name="plus" [size]="13" />Adicionar</button>
                  }
                </li>
              }
            </ul>
          } @else { <p class="mt-2 text-[13px] text-faint">Ninguém escreveu ainda.</p> }
        </section>
      }

      @case ('replies') {
        <section class="mt-5 rounded-3xl border border-edge bg-panel p-5">
          <h3 class="font-semibold">Tempo de resposta</h3>
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <label class="rounded-2xl bg-night/60 p-4"><span class="text-[13px] text-mute">Esperar depois da última mensagem</span>
              <span class="mt-1.5 flex items-center gap-2"><input type="number" min="0" max="120" class="field !w-20 !py-1 text-center" [value]="wait()" (change)="setWait($any($event.target).value)"> segundos</span></label>
            <label class="rounded-2xl bg-night/60 p-4"><span class="text-[13px] text-mute">Até, se a pessoa ainda estiver digitando</span>
              <span class="mt-1.5 flex items-center gap-2"><input type="number" min="0" max="300" class="field !w-20 !py-1 text-center" [value]="waitMax()" (change)="setWaitMax($any($event.target).value)"> segundos</span></label>
          </div>
          <label class="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-night/60 p-4 text-[13.5px]">
            <span class="text-mute">Padrão: quem não é da casa (atendimento e grupos) aciona o agente até</span>
            <input type="number" min="0" max="1000" class="field !w-20 !py-1 text-center" [value]="perHour()" (change)="setPerHour($any($event.target).value)" aria-label="Mensagens por pessoa por hora">
            <span class="text-mute">mensagens por pessoa por hora</span>
            <span class="w-full text-[12px] text-faint">Passando disso, a mensagem fica registrada mas o agente não responde até a hora virar. 0 = sem limite (cuidado: alguém pode gastar a sua cota). Cada conversa pode ter o seu na aba Conversas.</span>
          </label>
          <p class="mt-3 text-[12.5px] leading-relaxed text-faint">Mensagens seguidas ("oi, tudo bem?" + "preciso da sua ajuda") viram uma resposta só, e quem ainda está escrevendo não é interrompido. 0 e 0 respondem na hora.</p>
          <div class="mt-4 border-t border-edge pt-4">
            <app-switch [checked]="split()" (changed)="setSplit($event)" label="Responder em mensagens curtas"
                        hint="Cada parágrafo que o agente escrever sai como uma mensagem. Quem decide como quebrar é o agente, pelas instruções dele." />
          </div>
        </section>
        <section class="mt-4 rounded-3xl border border-edge bg-panel p-5">
          <h3 class="font-semibold">Agentes mandando mensagem</h3>
          <div class="mt-3 space-y-3">
            <app-switch [checked]="any()" (changed)="setAny($event)" label="Podem mandar para qualquer número sem me perguntar"
                        hint="Desligado, a primeira mensagem para quem nunca falou com vocês vira uma decisão na Triagem. Ligar aumenta o risco de bloqueio do número." />
            <app-switch [checked]="notifyOn()" (changed)="setNotify($event)" label="Avisar pelo WhatsApp quando um agente parar esperando por mim"
                        hint="Vai para os números que podem conversar com os agentes (ou para você mesmo)." />
          </div>
        </section>
      }
    }
  `,
})
export class WhatsappConfig {
  private readonly ipc = inject(IpcService);
  private readonly settings = inject(SettingsApiService);
  private readonly agents = inject(AgentsService);

  protected readonly tab = signal<Tab>('numbers');
  protected readonly wa = signal<WaStatusDto | null>(null);
  protected readonly accounts = computed(() => this.wa()?.accounts ?? []);
  protected readonly contacts = signal<WaContactDto[]>([]);
  protected readonly owners = signal<string[]>([]);
  protected readonly chats = signal<WaChatDto[]>([]);
  protected readonly groups = signal<{ account: string; id: string; name: string; size: number }[]>([]);
  protected readonly tabs = computed(() => [
    { id: 'numbers' as const, label: 'Números', n: this.accounts().length },
    { id: 'chats' as const, label: 'Conversas', n: this.chats().length },
    { id: 'people' as const, label: 'Pessoas', n: this.owners().length },
    { id: 'replies' as const, label: 'Como responder', n: null },
  ]);
  protected readonly any = signal(false);
  protected readonly notifyOn = signal(true);
  protected readonly wait = signal(8);
  protected readonly waitMax = signal(60);
  protected readonly split = signal(true);
  protected readonly listenDelay = signal(10);
  protected readonly perHour = signal(20);
  /** contatos recentes que ainda não têm configuração própria */
  protected readonly contactChats = computed(() => this.contacts().filter(c => !this.chats().some(l => l.chat === (c.chat ?? `${c.phone}@s.whatsapp.net`))));
  /** o que dá para configurar: grupos dos números conectados e contatos recentes ainda sem configuração */
  protected readonly chatOptions = computed<SelectOption[]>(() => [
    ...this.groups().map(g => ({ value: `g|${g.account}|${g.id}|${g.name}`, label: g.name, hint: `${g.size} participantes`, icon: 'users' as const, group: 'Grupos' })),
    ...this.contactChats().map(c => ({
      value: `c|${c.account ?? 'main'}|${c.chat ?? `${c.phone}@s.whatsapp.net`}|${c.name ?? formatPhone(c.phone)}`,
      label: c.name ?? formatPhone(c.phone), hint: c.name ? formatPhone(c.phone) : c.last_text, icon: 'message' as const, group: 'Contatos recentes',
    })),
  ]);
  protected readonly loadingGroups = signal(false);
  protected readonly phone = signal('');
  protected readonly ownerInput = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly digits = digits;
  protected readonly fmt = formatPhone;
  protected readonly when = (c: WaContactDto) => new Date(c.last_in_at ?? c.last_out_at ?? Date.now());
  protected readonly num = (v: string) => Number(v) || null;

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(this.ipc.on('ext:changed', () => this.load()));
    this.settings.get('wa:owners').then(v => this.owners.set(v ? JSON.parse(v) : []));
    this.settings.get('wa:any').then(v => this.any.set(v === '1'));
    this.settings.get('wa:notify').then(v => this.notifyOn.set(v !== '0'));
    this.settings.get('wa:listenDelay').then(v => this.listenDelay.set(v === null ? 10 : Number(v) || 10));
    this.settings.get('wa:wait').then(v => this.wait.set(v === null ? 8 : Number(v) || 0));
    this.settings.get('wa:waitMax').then(v => this.waitMax.set(v === null ? 60 : Number(v) || 0));
    this.settings.get('wa:split').then(v => this.split.set(v !== '0'));
    this.settings.get('wa:perHour').then(v => this.perHour.set(v === null ? 20 : Number(v) || 0));
  }

  private async load(): Promise<void> {
    this.wa.set(await this.ipc.invoke('wa:status'));
    this.contacts.set(await this.ipc.invoke('wa:contacts'));
    this.chats.set(await this.ipc.invoke('wa:chats'));
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try { await fn(); await this.load(); } catch (e) { this.error.set(errorMessage(e)); } finally { this.busy.set(false); }
  }

  protected pair(): void { this.run(async () => { await this.ipc.invoke('wa:pair', null, digits(this.phone())); this.phone.set(''); }); }
  protected logout(account: string): void { this.run(() => this.ipc.invoke('wa:logout', account)); }
  protected setOpen(account: string, on: boolean): void { this.run(() => this.ipc.invoke('wa:setOpen', account, on)); }
  protected setAgent(account: string, id: string): void { this.run(() => this.ipc.invoke('wa:setAgent', account, Number(id) || null)); }
  protected agentName(id: number | null): string { return id ? this.agents.byId().get(id)?.name ?? 'o agente' : 'a Central'; }
  protected isRestricted(id: number | null): boolean { return !!id && !!this.agents.byId().get(id)?.restricted; }
  protected accountAgent(account: string): number | null { return this.wa()?.accounts.find(a => a.account === account)?.agent_id ?? null; }

  /** grupos de cada número conectado (carrega ao abrir a lista) */
  protected async loadGroups(): Promise<void> {
    this.loadingGroups.set(true);
    const open = this.accounts().filter(a => a.state === 'open');
    const all = await Promise.all(open.map(a => this.ipc.invoke('wa:groups', a.account).then(gs => gs.map(g => ({ ...g, account: a.account })), () => [])));
    this.groups.set(all.flat().filter(g => !this.chats().some(l => l.chat === g.id)));
    this.loadingGroups.set(false);
  }
  private saveChats(list: WaChatCfg[]): void {
    this.chats.set(list.map(c => ({ pending: 0, last_run: null, ...this.chats().find(x => x.account === c.account && x.chat === c.chat), ...c })));
    this.run(() => this.ipc.invoke('wa:setChats', list.map(({ account, chat, name, group, reply, reply_agent, listen, listen_agent, per_hour }) => ({ account, chat, name, group, reply, reply_agent, listen, listen_agent, per_hour: per_hour ?? null }))));
  }
  /** grupo entra escutando e sem resposta; contato entra escutando e com o padrão do número */
  protected addChat(v: string): void {
    if (!v) return;
    const [kind, account, chat, ...name] = v.split('|');
    const group = kind === 'g';
    this.saveChats([...this.chats(), { account, chat, name: name.join('|'), group, reply: group ? 'off' : 'inherit', reply_agent: null, listen: true, listen_agent: null }]);
    this.groups.update(g => g.filter(x => x.id !== chat));
  }
  protected removeChat(c: WaChatCfg): void { this.saveChats(this.chats().filter(x => !(x.account === c.account && x.chat === c.chat))); }
  protected patchChat(c: WaChatCfg, patch: Partial<WaChatCfg>): void { this.saveChats(this.chats().map(x => (x.account === c.account && x.chat === c.chat ? { ...x, ...patch } : x))); }
  protected replyOptions(c: WaChatCfg) {
    return [{ id: 'inherit' as const, label: c.group ? 'Não (padrão)' : 'Padrão do número' }, { id: 'on' as const, label: 'Sim' }, { id: 'off' as const, label: 'Não' }].filter(o => !(c.group && o.id === 'off'));
  }
  /** vazio = volta ao padrão */
  protected setChatLimit(c: WaChatCfg, v: string): void { this.patchChat(c, { per_hour: v.trim() === '' ? null : Math.max(0, Math.min(1000, Math.round(Number(v) || 0))) }); }
  protected digestNow(c: WaChatCfg): void { this.run(() => this.ipc.invoke('wa:digestNow', c.account, c.chat)); }
  protected setListenDelay(v: string): void { const n = Math.max(1, Math.min(240, Math.round(Number(v) || 10))); this.listenDelay.set(n); this.settings.set('wa:listenDelay', String(n)); }

  private saveOwners(list: string[]): void { this.owners.set(list); this.settings.set('wa:owners', JSON.stringify(list)); }
  protected addOwner(): void {
    const n = digits(this.ownerInput());
    if (n.length >= 12 && !this.owners().includes(n)) this.saveOwners([...this.owners(), n]);
    this.ownerInput.set('');
  }
  protected addOwnerNumber(n: string): void { if (!this.owners().includes(n)) this.saveOwners([...this.owners(), n]); }
  protected removeOwner(n: string): void { this.saveOwners(this.owners().filter(x => x !== n)); }
  protected readonly copied = signal<string | null>(null);
  protected copy(n: string): void {
    this.ipc.invoke('app:copy', n).then(() => { this.copied.set(n); setTimeout(() => { if (this.copied() === n) this.copied.set(null); }, 1500); });
  }
  protected setAny(v: boolean): void { this.any.set(v); this.settings.set('wa:any', v ? '1' : '0'); }
  protected setWait(v: string): void { const n = Math.max(0, Math.min(120, Math.round(Number(v) || 0))); this.wait.set(n); this.settings.set('wa:wait', String(n)); }
  protected setWaitMax(v: string): void { const n = Math.max(0, Math.min(300, Math.round(Number(v) || 0))); this.waitMax.set(n); this.settings.set('wa:waitMax', String(n)); }
  protected setPerHour(v: string): void { const n = Math.max(0, Math.min(1000, Math.round(Number(v) || 0))); this.perHour.set(n); this.settings.set('wa:perHour', String(n)); }
  protected setSplit(v: boolean): void { this.split.set(v); this.settings.set('wa:split', v ? '1' : '0'); }
  protected setNotify(v: boolean): void { this.notifyOn.set(v); this.settings.set('wa:notify', v ? '1' : '0'); }
}
