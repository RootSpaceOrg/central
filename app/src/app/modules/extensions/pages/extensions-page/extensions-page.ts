import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

import { ExtensionDto, SttStatusDto, WaChatCfg, WaChatDto, WaContactDto, WaStatusDto } from '../../../../shared/contract';
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

              <h3 class="mt-7 font-semibold">Conversas</h3>
              <p class="mt-0.5 text-[13px] text-mute">Controle por conversa (contato ou grupo), por cima do padrão do número. <b class="text-text">Responder</b>: quem responde ali (ou ninguém).
                <b class="text-text">Escutar</b>: um agente lê os trechos da conversa e registra o que impacta os projetos como ideias ou decisões. Os dois podem ficar ligados, com agentes iguais ou diferentes.</p>
              <div class="mt-3 space-y-2">
                @for (c of chats(); track c.account + c.chat) {
                  <div class="rounded-xl border border-edge bg-night/60 px-3 py-3">
                    <div class="flex items-center gap-2">
                      <span class="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" [class]="c.group ? 'bg-frost/15 text-frost' : 'bg-raise text-mute'">{{ c.group ? 'grupo' : 'contato' }}</span>
                      <span class="min-w-0 flex-1 truncate font-semibold">{{ c.name }}</span>
                      <button type="button" class="grid size-7 place-items-center rounded-lg text-faint hover:bg-raise hover:text-no" (click)="removeChat(c)" [attr.aria-label]="'Tirar ' + c.name + ' da lista'" title="Tirar da lista (volta ao padrão do número)"><app-icon name="close" [size]="14" /></button>
                    </div>
                    <div class="mt-2.5 grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <!-- responder -->
                      <div class="rounded-lg border border-edge px-3 py-2.5">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="w-20 text-[13px] font-semibold">Responder</span>
                          <div class="flex rounded-lg border border-edge p-0.5" role="radiogroup" [attr.aria-label]="'Responder em ' + c.name">
                            @for (o of replyOptions(c); track o.id) {
                              <button type="button" role="radio" [attr.aria-checked]="c.reply === o.id" (click)="patchChat(c, { reply: o.id })"
                                      class="rounded-md px-2.5 py-1 text-[12.5px]" [class]="c.reply === o.id ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-text'">{{ o.label }}</button>
                            }
                          </div>
                        </div>
                        @if (c.reply === 'on') {
                          <div class="mt-2 flex items-center gap-2"><span class="w-20 text-[12.5px] text-mute">Quem</span>
                            <app-agent-select class="min-w-0 flex-1" [compact]="true" [value]="c.reply_agent ? '' + c.reply_agent : ''" (valueChange)="patchChat(c, { reply_agent: num($event) })" noneLabel="O agente do número" /></div>
                          @if (!isRestricted(c.reply_agent ?? accountAgent(c.account))) {
                            <p class="mt-1.5 text-[12px] text-no">{{ agentName(c.reply_agent ?? accountAgent(c.account)) }} não tem atuação restrita: {{ c.group ? 'quem está no grupo' : 'essa pessoa' }} falaria com um agente que mexe na Central.</p>
                          }
                        } @else {
                          <p class="mt-1.5 text-[12px] text-faint">{{ c.reply === 'off' ? 'Ninguém responde nesta conversa.' : c.group ? 'Grupos não têm resposta por padrão.' : 'Segue o padrão do número (quem responde lá, e só para quem pode conversar com os agentes).' }}</p>
                        }
                      </div>
                      <!-- escutar -->
                      <div class="rounded-lg border border-edge px-3 py-2.5">
                        <label class="flex cursor-pointer items-center gap-2">
                          <span class="w-20 text-[13px] font-semibold">Escutar</span>
                          <input type="checkbox" class="accent-frost" [checked]="c.listen" (change)="patchChat(c, { listen: $any($event.target).checked })">
                          <span class="text-[12.5px] text-mute">{{ c.listen ? (c.pending ? c.pending + (c.pending === 1 ? ' mensagem esperando leitura' : ' mensagens esperando leitura') : 'nada novo') : 'desligado' }}</span>
                          @if (c.listen) { <button type="button" class="btn btn-sm ml-auto" [disabled]="!c.pending" (click)="digestNow(c)" title="Ler agora o que acumulou">Ler agora</button> }
                        </label>
                        @if (c.listen) {
                          <div class="mt-2 flex items-center gap-2"><span class="w-20 text-[12.5px] text-mute">Quem lê</span>
                            <app-agent-select class="min-w-0 flex-1" [compact]="true" [value]="c.listen_agent ? '' + c.listen_agent : ''" (valueChange)="patchChat(c, { listen_agent: num($event) })" noneLabel="A Central" /></div>
                        }
                      </div>
                    </div>
                  </div>
                } @empty {
                  <p class="text-[13px] text-faint">Nenhuma conversa configurada: vale o padrão do número.</p>
                }
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <select class="field !w-80 !py-1.5 text-[13px]" aria-label="Configurar uma conversa" (focus)="loadGroups()" (change)="addChat($any($event.target).value); $any($event.target).value = ''">
                  <option value="">+ Configurar um grupo ou contato…</option>
                  @if (groups().length) {
                    <optgroup label="Grupos">
                      @for (g of groups(); track g.account + g.id) { <option [value]="'g|' + g.account + '|' + g.id + '|' + g.name">{{ g.name }} ({{ g.size }})</option> }
                    </optgroup>
                  }
                  @if (contactChats().length) {
                    <optgroup label="Contatos recentes">
                      @for (c of contactChats(); track c.phone) { <option [value]="'c|' + (c.account ?? 'main') + '|' + (c.chat ?? c.phone + '@s.whatsapp.net') + '|' + (c.name ?? fmt(c.phone))">{{ c.name ?? fmt(c.phone) }}</option> }
                    </optgroup>
                  }
                </select>
                <span class="flex items-center gap-2 text-[13px]">Escuta lê depois de
                  <input type="number" min="1" max="240" class="field !w-16 !py-1 text-center" aria-label="Minutos de conversa antes de ler" [value]="listenDelay()" (change)="setListenDelay($any($event.target).value)">
                  minutos de conversa</span>
              </div>

              <h3 class="mt-7 font-semibold">Como os agentes respondem</h3>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span>Esperar</span>
                <input type="number" min="0" max="120" class="field !w-20 !py-1 text-center" aria-label="Segundos de espera depois da última mensagem" [value]="wait()" (change)="setWait($any($event.target).value)">
                <span>segundos depois da última mensagem, e até</span>
                <input type="number" min="0" max="300" class="field !w-20 !py-1 text-center" aria-label="Segundos de espera enquanto a pessoa digita" [value]="waitMax()" (change)="setWaitMax($any($event.target).value)">
                <span>segundos se a pessoa ainda estiver digitando</span>
                <span class="w-full text-[13px] text-mute">Mensagens seguidas ("oi, tudo bem?" + "preciso da sua ajuda") viram uma resposta só, e quem ainda está escrevendo não é interrompido. 0 e 0 respondem na hora.</span>
              </div>
              <label class="mt-3 flex cursor-pointer items-start gap-3">
                <input type="checkbox" class="mt-1 accent-frost" [checked]="split()" (change)="setSplit($any($event.target).checked)">
                <span><span class="block">Responder em mensagens curtas</span>
                  <span class="block text-[13px] text-mute">Cada parágrafo que o agente escrever sai como uma mensagem, em vez de um textão. Quem decide como quebrar é o agente: o jeito de responder vai nas instruções dele (ex.: "uma mensagem só", "saudação curta e depois a resposta").</span></span>
              </label>

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
  protected readonly wait = signal(8);
  protected readonly chats = signal<WaChatDto[]>([]);
  protected readonly groups = signal<{ account: string; id: string; name: string; size: number }[]>([]);
  protected readonly listenDelay = signal(10);
  /** contatos recentes que ainda não são escutados */
  protected readonly contactChats = computed(() => this.contacts().filter(c => !this.chats().some(l => l.chat === (c.chat ?? `${c.phone}@s.whatsapp.net`))));
  protected readonly waitMax = signal(60);
  protected readonly split = signal(true);
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
    this.settings.get('wa:listenDelay').then(v => this.listenDelay.set(v === null ? 10 : Number(v) || 10));
    this.settings.get('wa:wait').then(v => this.wait.set(v === null ? 8 : Number(v) || 0));
    this.settings.get('wa:waitMax').then(v => this.waitMax.set(v === null ? 60 : Number(v) || 0));
    this.settings.get('wa:split').then(v => this.split.set(v !== '0'));
  }

  private async load(): Promise<void> {
    this.list.set(await this.ipc.invoke('ext:list'));
    if (this.list().find(e => e.id === 'transcricao')?.installed) this.stt.set(await this.ipc.invoke('stt:status'));
    if (this.waInstalled()) {
      this.wa.set(await this.ipc.invoke('wa:status'));
      this.contacts.set(await this.ipc.invoke('wa:contacts'));
      this.chats.set(await this.ipc.invoke('wa:chats'));
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
  /** grupos de cada número conectado (carrega ao abrir a lista) */
  protected async loadGroups(): Promise<void> {
    const open = (this.wa()?.accounts ?? []).filter(a => a.state === 'open');
    const all = await Promise.all(open.map(a => this.ipc.invoke('wa:groups', a.account).then(gs => gs.map(g => ({ ...g, account: a.account })), () => [])));
    this.groups.set(all.flat().filter(g => !this.chats().some(l => l.chat === g.id)));
  }
  private saveChats(list: WaChatCfg[]): void {
    this.chats.set(list.map(c => ({ pending: 0, last_run: null, ...this.chats().find(x => x.account === c.account && x.chat === c.chat), ...c })));
    this.run(() => this.ipc.invoke('wa:setChats', list.map(({ account, chat, name, group, reply, reply_agent, listen, listen_agent }) => ({ account, chat, name, group, reply, reply_agent, listen, listen_agent }))));
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
  protected readonly num = (v: string) => Number(v) || null;
  protected accountAgent(account: string): number | null { return this.wa()?.accounts.find(a => a.account === account)?.agent_id ?? null; }
  protected digestNow(c: WaChatCfg): void { this.run(() => this.ipc.invoke('wa:digestNow', c.account, c.chat)); }
  protected setListenDelay(v: string): void { const n = Math.max(1, Math.min(240, Math.round(Number(v) || 10))); this.listenDelay.set(n); this.settings.set('wa:listenDelay', String(n)); }
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
  protected setWait(v: string): void { const n = Math.max(0, Math.min(120, Math.round(Number(v) || 0))); this.wait.set(n); this.settings.set('wa:wait', String(n)); }
  protected setWaitMax(v: string): void { const n = Math.max(0, Math.min(300, Math.round(Number(v) || 0))); this.waitMax.set(n); this.settings.set('wa:waitMax', String(n)); }
  protected setSplit(v: boolean): void { this.split.set(v); this.settings.set('wa:split', v ? '1' : '0'); }
  protected setNotify(v: boolean): void { this.notifyOn.set(v); this.settings.set('wa:notify', v ? '1' : '0'); }
}
