import { Component, DestroyRef, inject, signal } from '@angular/core';

import { RemoteStatus } from '../../../../../../shared/contract';
import { AskService } from '../../../../../../shared/services/ask/ask.service';
import { IpcService } from '../../../../../../shared/services/ipc/ipc.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { Switch } from '../../../../../../shared/ui/switch';

/**
 * Utils > Celular: a Central no celular pelo Tailscale. Liga o servidor (só no endereço do Tailscale), mostra o código
 * e o QR de pareamento e os aparelhos pareados (dá para tirar). Sem contrato próprio: só repassa o IPC (escape valve).
 */
@Component({
  selector: 'app-phone',
  imports: [AgoPipe, Icon, Switch],
  host: { class: 'block max-w-[760px]' },
  template: `
    @if (st(); as s) {
      <app-switch [checked]="s.on" (changed)="set($event)" label="Usar a Central no celular"
                  hint="Decisões, entregas para usar (com o vídeo), as rodadas do 1:1 e conversas com os agentes. Só pelo Tailscale: nada fica aberto na internet." />

      @if (s.on) {
        <ol class="mt-6 space-y-4">
          <!-- 1. Tailscale -->
          <li class="rounded-2xl border bg-panel p-5" [class]="s.tailscale ? 'border-yes/40' : 'border-later/50'">
            <p class="flex items-center gap-2 font-semibold">
              <span class="grid size-6 place-items-center rounded-full text-[12px] font-bold" [class]="s.tailscale ? 'bg-yes text-night' : 'bg-later text-night'">1</span>
              Tailscale {{ s.tailscale ? 'conectado' : 'desconectado' }}
              @if (s.ip) { <span class="font-mono text-[12px] font-normal text-faint">{{ s.ip }}</span> }
            </p>
            @if (!s.tailscale) {
              <div class="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-mute">
                <p>O Tailscale cria uma rede privada entre o PC e o celular (funciona fora de casa, no 4G).</p>
                <p><b class="text-text">No PC:</b> abra o Tailscale (ícone perto do relógio) e entre com a sua conta Google, Microsoft ou GitHub.</p>
                <p><b class="text-text">No celular:</b> instale o app Tailscale (App Store ou Play Store) e entre com a <b class="text-text">mesma conta</b>.</p>
                <p class="text-faint">Esta tela atualiza sozinha quando o Tailscale conectar.</p>
              </div>
            }
          </li>

          <!-- 2. endereço e pareamento -->
          <li class="rounded-2xl border border-edge bg-panel p-5" [class.opacity-50]="!s.running">
            <p class="flex items-center gap-2 font-semibold">
              <span class="grid size-6 place-items-center rounded-full bg-frost text-[12px] font-bold text-night">2</span>Parear o celular</p>
            @if (s.url) {
              <p class="mt-2 text-[13.5px] text-mute">No celular, com o Tailscale ligado, abra no navegador:</p>
              <p class="mt-1 select-all rounded-lg bg-night px-3 py-2 font-mono text-[15px] text-frost">{{ s.url }}</p>
              @if (s.pairing; as pr) {
                <div class="mt-4 flex flex-wrap items-center gap-6">
                  <img [src]="pr.qr" alt="QR code de pareamento" class="size-[180px] rounded-xl bg-white p-2" />
                  <div>
                    <p class="text-[13px] text-mute">Leia o QR com a câmera, ou digite o código:</p>
                    <p class="mt-1 font-display text-[40px] font-bold tracking-[0.2em]">{{ pr.code }}</p>
                    <p class="text-[12px] text-faint">vale por 10 minutos e uma vez só</p>
                  </div>
                </div>
              } @else {
                <button type="button" class="btn btn-primary mt-4" (click)="pair()"><app-icon name="plus" [size]="14" />Gerar código de pareamento</button>
              }
              <!-- endereço com cadeado: sem ele o Chrome só cria um atalho; com ele, instala como app (tela cheia, ícone) -->
              <div class="mt-4 rounded-xl border px-4 py-3" [class]="s.https.state === 'on' ? 'border-yes/40 bg-yes/[0.05]' : 'border-edge bg-night/40'">
                @switch (s.https.state) {
                  @case ('on') { <p class="text-[13px] text-yes"><b>Endereço com cadeado ligado.</b> No Chrome do celular: menu ⋮ › <b>Instalar app</b> (ou "Adicionar à tela inicial").</p> }
                  @case ('waiting') {
                    @if (s.https.enableUrl; as link) {
                      <p class="text-[13px]"><b>Falta um clique na sua conta do Tailscale:</b> abra o link, confirme e volte aqui (ativa o HTTPS do seu PC; a Central termina sozinha).</p>
                      <button type="button" class="btn btn-sm btn-primary mt-2" (click)="open(link)"><app-icon name="external" [size]="13" />Ativar no Tailscale</button>
                    } @else { <p class="flex items-center gap-2 text-[13px] text-mute"><span class="pulse size-2 rounded-full bg-frost"></span>Pedindo o endereço ao Tailscale…</p> }
                  }
                  @default {
                    <p class="text-[13px] text-mute">Para virar <b class="text-text">app no celular</b> (ícone e tela cheia, sem a barra do Chrome), o endereço precisa de cadeado. O Tailscale dá um, de graça.</p>
                    @if (s.https.error; as e) { <p class="mt-1 text-[12px] text-no">{{ e }}</p> }
                    <button type="button" class="btn btn-sm mt-2" (click)="https()"><app-icon name="lock" [size]="13" />Endereço com cadeado</button>
                  }
                }
              </div>
            } @else { <p class="mt-2 text-[13px] text-faint">Aparece quando o Tailscale conectar.</p> }
          </li>

          <!-- 3. aparelhos -->
          <li class="rounded-2xl border border-edge bg-panel p-5">
            <p class="font-semibold">Aparelhos pareados</p>
            <ul class="mt-2 space-y-1.5">
              @for (d of s.devices; track d.id) {
                <li class="flex items-center gap-3 text-[13.5px]">
                  <app-icon name="desk" [size]="15" class="text-faint" />
                  <span class="flex-1">{{ d.name }} <span class="text-faint">· pareado {{ date(d.created) | ago }}{{ d.last ? ' · usado ' : '' }}@if (d.last) { {{ date(d.last) | ago }} }</span></span>
                  <button type="button" class="text-[12.5px] text-no hover:underline" (click)="revoke(d.id, d.name)">Desparear</button>
                </li>
              } @empty { <li class="text-[13px] text-faint">Nenhum ainda.</li> }
            </ul>
            <p class="mt-3 text-[12px] leading-relaxed text-faint">Perdeu o celular? Desparear aqui e tirar o aparelho no painel do Tailscale cortam o acesso. Do celular dá para decidir, aprovar entregas (sem merge), responder o 1:1 e conversar; agente com permissão total, terminal e merge ficam só no PC.</p>
          </li>
        </ol>
      }
    }`,
})
export class Phone {
  private readonly ipc = inject(IpcService);
  private readonly ask = inject(AskService);
  protected readonly st = signal<RemoteStatus | null>(null);

  constructor() {
    const load = () => this.ipc.invoke('remote:status').then(s => this.st.set(s), () => {});
    load();
    const off = this.ipc.on('remote:changed', load);
    // o Tailscale pode conectar a qualquer momento; o código vence em 10 min
    const t = setInterval(load, 5000);
    inject(DestroyRef).onDestroy(() => { off(); clearInterval(t); });
  }

  protected date(s: string) { return new Date(s); }
  protected set(on: boolean): void { this.ipc.invoke('remote:set', on).then(() => this.ipc.invoke('remote:status')).then(s => this.st.set(s)); }
  protected https(): void { this.ipc.invoke('remote:https').then(() => this.ipc.invoke('remote:status')).then(s => this.st.set(s)); }
  protected open(url: string): void { this.ipc.invoke('shell:external', url); }
  protected pair(): void { this.ipc.invoke('remote:pair').then(() => this.ipc.invoke('remote:status')).then(s => this.st.set(s)); }
  protected async revoke(id: string, name: string): Promise<void> {
    if (!(await this.ask.confirm(`Desparear "${name}"? Ele perde o acesso na hora.`, { confirmLabel: 'Desparear' }))) return;
    await this.ipc.invoke('remote:revoke', id);
  }
}
