import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

import { SttStatusDto } from '../../../../../../shared/contract';
import { DictationService } from '../../../../../../shared/services/dictation/dictation.service';
import { IpcService, errorMessage } from '../../../../../../shared/services/ipc/ipc.service';
import { Icon } from '../../../../../../shared/ui/icon';
import { Select } from '../../../../../../shared/ui/select';
import { Switch } from '../../../../../../shared/ui/switch';

type Patch = { engine?: 'local' | 'openai'; model?: 'small' | 'base'; openaiModel?: string; key?: string | null };

/** Configuração da Transcrição: motor (local ou OpenAI), o que baixar, e onde a transcrição é usada (ditado nos chats). */
@Component({
  selector: 'app-transcricao-config',
  imports: [Icon, Switch, Select],
  host: { class: 'block' },
  template: `
    @let t = stt();
    <!-- situação: pronto ou o que falta -->
    @if (t) {
      <div class="flex flex-wrap items-center gap-4 rounded-3xl border px-6 py-5" [class]="t.ready ? 'border-yes/30 bg-yes/8' : 'border-later/30 bg-later/8'">
        <span class="grid size-11 shrink-0 place-items-center rounded-full" [class]="t.ready ? 'bg-yes/15 text-yes' : 'bg-later/15 text-later'"><app-icon [name]="t.ready ? 'check' : 'download'" [size]="20" /></span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ t.ready ? 'Pronta para transcrever' : 'Falta pouco' }}</p>
          <p class="text-[13.5px] text-mute">{{ t.ready ? (t.engine === 'local' ? 'Motor local, modelo ' + t.model + '. Roda no seu PC.' : 'OpenAI, ' + t.openaiModel + '.') : (t.engine === 'local' ? 'Baixe o motor local uma vez (' + prepareSize() + ').' : 'Guarde a sua chave da OpenAI abaixo.') }}</p>
        </div>
        @if (!t.ready && t.engine === 'local' && !downloading()) {
          <button type="button" class="btn btn-primary" (click)="prepare()"><app-icon name="download" [size]="15" />Preparar ({{ prepareSize() }})</button>
        }
      </div>
      @if (downloading()) {
        @let p = t.ext?.progress;
        <div class="mt-3 px-1">
          <p class="text-[12.5px] text-mute">{{ p ? 'Baixando ' + assetName(p.name) + ': ' + mb(p.done) + ' de ' + mb(p.total) + ' MB' : 'Começando…' }}</p>
          <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-raise">
            <div class="h-full rounded-full bg-frost transition-all" [class.animate-pulse]="!p" [style.width.%]="p ? (p.done / p.total) * 100 : 4"></div></div>
        </div>
      }
      @if (t.ext?.error) { <p class="mt-3 rounded-2xl bg-no/10 px-5 py-3 text-[13.5px] text-no">{{ t.ext!.error }}</p> }
    }
    @if (error()) { <p role="alert" class="mt-3 rounded-2xl bg-no/10 px-5 py-3 text-no">{{ error() }}</p> }

    <div class="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section class="rounded-3xl border border-edge bg-panel p-6">
        <h3 class="font-semibold">Motor</h3>
        <div class="mt-3 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Motor de transcrição">
          @for (o of engines; track o.id) {
            <button type="button" role="radio" [attr.aria-checked]="t?.engine === o.id" (click)="config({ engine: o.id })"
                    class="rounded-2xl border-2 px-4 py-3.5 text-left transition-colors" [class]="t?.engine === o.id ? 'border-frost bg-frost/10' : 'border-edge bg-night/60 hover:border-faint'">
              <span class="flex items-center gap-2 font-semibold">{{ o.label }}@if (t?.engine === o.id) { <app-icon name="check" [size]="15" class="ml-auto text-frost" /> }</span>
              <span class="mt-1 block text-[12.5px] leading-relaxed text-mute">{{ o.hint }}</span></button>
          }
        </div>

        @if (t?.engine === 'local') {
          <h4 class="mt-6 text-[13px] font-semibold text-mute">Modelo</h4>
          <div class="mt-2 grid grid-cols-2 gap-3">
            @for (m of models; track m.id) {
              <button type="button" (click)="config({ model: m.id })" class="rounded-2xl border px-4 py-3 text-left" [class]="t?.model === m.id ? 'border-frost/60 bg-frost/8' : 'border-edge hover:border-faint'">
                <span class="flex items-center gap-2 font-semibold">{{ m.label }}
                  @if (t?.ext?.models?.[m.id]) { <span class="ml-auto rounded-full bg-yes/12 px-2 text-[11.5px] font-normal text-yes">baixado</span> }</span>
                <span class="mt-0.5 block text-[12.5px] text-mute">{{ m.hint }}</span></button>
            }
          </div>
          <p class="mt-3 text-[12.5px] text-faint">Sem nuvem e sem gastar a cota do Claude. Trocar de modelo pede para preparar de novo (só baixa o que falta).</p>
        } @else {
          <h4 class="mt-6 text-[13px] font-semibold text-mute">Chave da OpenAI</h4>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            @if (t?.hasKey) {
              <span class="flex items-center gap-1.5 rounded-full bg-yes/12 px-3 py-1.5 text-[13px] text-yes"><app-icon name="check" [size]="13" />Guardada, criptografada pelo Windows</span>
              <button type="button" class="btn btn-sm btn-ghost !text-no" (click)="config({ key: null })">Remover</button>
            } @else {
              <input class="field min-w-0 flex-1 font-mono text-[13px]" type="password" autocomplete="off" placeholder="sk-..." aria-label="Chave da OpenAI" [value]="keyInput()" (input)="keyInput.set($any($event.target).value)">
              <button type="button" class="btn" [disabled]="keyInput().trim().length < 20" (click)="saveKey()">Guardar</button>
            }
          </div>
          <h4 class="mt-5 text-[13px] font-semibold text-mute">Modelo</h4>
          <app-select class="mt-2 block w-72" [options]="openaiOptions" [value]="t?.openaiModel ?? ''" (picked)="config({ openaiModel: $event })" label="Modelo da OpenAI" />
          <p class="mt-3 text-[12.5px] text-faint">Cobrado na sua conta da OpenAI por áudio transcrito. A chave só sai do seu PC para a própria OpenAI.</p>
        }

        <div class="mt-6 flex flex-wrap items-center gap-3 border-t border-edge pt-4 text-[13px]">
          <span class="flex-1 text-mute">Vídeo (quadros + fala) usa o ffmpeg no seu PC, com qualquer motor.</span>
          @if (t?.ext?.ffmpeg) { <span class="flex items-center gap-1.5 text-yes"><app-icon name="check" [size]="14" />Pronto para vídeo</span> }
          @else if (!downloading() && t?.engine === 'openai') { <button type="button" class="btn btn-sm" (click)="prepare()"><app-icon name="download" [size]="14" />Preparar (ffmpeg, 34 MB)</button> }
        </div>
      </section>

      <section class="rounded-3xl border border-edge bg-panel p-6">
        <h3 class="font-semibold">Onde é usada</h3>
        <app-switch class="mt-3" [checked]="dictation.enabled()" (changed)="dictation.setEnabled($event)" label="Ditado nos chats"
                    hint="Botão de microfone na caixa de mensagem das conversas (Central, agentes e sessões). Você fala, o texto entra na caixa para revisar e enviar." />
        @if (dictation.enabled() && !t?.ready) { <p class="mt-1 px-1 text-[12px] text-later">Aparece quando o motor estiver pronto.</p> }
        <div class="mt-4 space-y-3 border-t border-edge pt-4 text-[13px]">
          <p class="flex items-start gap-2.5"><app-icon name="message" [size]="16" class="mt-0.5 text-[#25D366]" />
            <span><b class="font-semibold text-text">WhatsApp</b><span class="block text-mute">Áudios e vídeos recebidos viram texto antes de o agente ler.</span></span></p>
        </div>
      </section>
    </div>
  `,
})
export class TranscricaoConfig {
  private readonly ipc = inject(IpcService);
  protected readonly dictation = inject(DictationService);

  protected readonly stt = signal<SttStatusDto | null>(null);
  protected readonly keyInput = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly engines = [
    { id: 'local' as const, label: 'Local (Whisper)', hint: 'No seu PC, grátis. Precisa preparar uma vez.' },
    { id: 'openai' as const, label: 'OpenAI', hint: 'Na nuvem, com a sua chave. Mais preciso em áudio ruim.' },
  ];
  protected readonly models = [
    { id: 'small' as const, label: 'Melhor', hint: 'small · 488 MB · mais preciso' },
    { id: 'base' as const, label: 'Rápido', hint: 'base · 148 MB · responde antes' },
  ];
  protected readonly openaiOptions = [
    { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', hint: 'Mais preciso' },
    { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe', hint: 'Mais barato' },
    { value: 'whisper-1', label: 'whisper-1', hint: 'O clássico' },
  ];
  protected readonly assetLabel: Record<string, string> = { whisper: 'o Whisper', ffmpeg: 'o ffmpeg', small: 'o modelo small', base: 'o modelo base' };
  protected readonly assetName = (n: string) => this.assetLabel[n] ?? n;
  protected readonly mb = (n: number) => Math.round(n / 1_048_576);
  protected readonly prepareSize = computed(() => {
    const t = this.stt(); if (!t) return '';
    const mb = (t.ext?.whisper ? 0 : 9) + (t.ext?.ffmpeg ? 0 : 34) + (t.ext?.models[t.model] ? 0 : t.model === 'small' ? 465 : 141);
    return `${mb} MB`;
  });
  /** clicou em Preparar: a barra aparece na hora (o primeiro aviso de progresso da extensão leva uns segundos) */
  private readonly preparing = signal(false);
  protected readonly downloading = computed(() => this.preparing() || !!this.stt()?.ext?.progress);

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(this.ipc.on('ext:changed', () => this.load()));
  }

  private async load(): Promise<void> { this.stt.set(await this.ipc.invoke('stt:status')); }

  protected config(patch: Patch): void {
    this.error.set(null);
    this.ipc.invoke('stt:config', patch).then(() => this.load(), e => this.error.set(errorMessage(e)));
  }
  protected saveKey(): void { const k = this.keyInput().trim(); this.keyInput.set(''); this.config({ key: k }); }
  // a preparação baixa centenas de MB: não prende a tela; o progresso chega pelo status
  protected prepare(): void {
    this.error.set(null);
    this.preparing.set(true);
    this.ipc.invoke('stt:prepare').catch(e => this.error.set(errorMessage(e))).finally(() => { this.preparing.set(false); this.load(); });
  }
}
