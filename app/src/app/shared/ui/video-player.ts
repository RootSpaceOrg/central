import { Component, ElementRef, input, signal, viewChild } from '@angular/core';

import { Icon } from './icon';

const SPEEDS = [1, 1.5, 2, 0.5];
const clock = (s: number) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

/**
 * Player de vídeo da Central (no lugar do controle padrão): barra para pular, ±5 s, velocidade, tela cheia.
 * Atalhos com o player em foco: espaço/K toca e pausa, ←/→ 5 s, J/L 10 s, F tela cheia, < > velocidade.
 * Os vídeos dos agentes são .webm sem duração gravada: o player descobre a duração antes de deixar pular.
 */
@Component({
  selector: 'app-video-player',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div #box class="group relative overflow-hidden rounded-2xl border border-edge bg-black outline-none focus-visible:ring-2 focus-visible:ring-frost"
         tabindex="0" (keydown)="key($event)" [attr.aria-label]="label() + ' (espaço toca e pausa, setas pulam 5 segundos)'">
      <video #v class="block max-h-[70vh] w-full cursor-pointer" [src]="src()" preload="metadata" playsinline
             (click)="toggle()" (dblclick)="full()" (play)="playing.set(true)" (pause)="playing.set(false)" (ended)="playing.set(false)"
             (loadedmetadata)="meta()" (durationchange)="durationFix()" (timeupdate)="tick()" (progress)="buffer()"></video>
      @if (!playing()) {
        <button type="button" class="absolute inset-0 m-auto grid size-16 place-items-center rounded-full bg-night/70 text-white backdrop-blur transition hover:scale-105 hover:bg-night/85"
                (click)="toggle()" aria-label="Tocar"><app-icon name="play" [size]="26" /></button>
      }
      <!-- controles: sempre visíveis pausado; tocando, aparecem com o mouse em cima -->
      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pt-8 pb-2 transition-opacity"
           [class.opacity-0]="playing()" [class.group-hover:opacity-100]="true" [class.group-focus-within:opacity-100]="true">
        <!-- barra: carregado, assistido e o ponto -->
        <div class="relative h-4">
          <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20">
            <div class="absolute inset-y-0 left-0 rounded-full bg-white/25" [style.width.%]="buffered()"></div>
            <div class="absolute inset-y-0 left-0 rounded-full bg-frost" [style.width.%]="duration() ? (time() / duration()) * 100 : 0"></div>
          </div>
          <input type="range" class="vp-range absolute inset-0 w-full cursor-pointer" min="0" [max]="duration() || 0" step="0.05" [value]="time()"
                 [disabled]="!duration()" (input)="seek(+$any($event.target).value)" aria-label="Posição no vídeo" />
        </div>
        <div class="mt-1 flex items-center gap-1 text-[12px] text-white/90">
          <button type="button" class="vp-btn" (click)="toggle()" [attr.aria-label]="playing() ? 'Pausar' : 'Tocar'">
            <app-icon [name]="playing() ? 'pause' : 'play'" [size]="16" /></button>
          <button type="button" class="vp-btn" (click)="jump(-5)" aria-label="Voltar 5 segundos" title="Voltar 5 s (←)">−5s</button>
          <button type="button" class="vp-btn" (click)="jump(5)" aria-label="Avançar 5 segundos" title="Avançar 5 s (→)">+5s</button>
          <span class="ml-1 tabular-nums">{{ clock(time()) }} <span class="text-white/50">/ {{ clock(duration()) }}</span></span>
          <span class="flex-1"></span>
          <button type="button" class="vp-btn min-w-[44px] font-semibold tabular-nums" (click)="nextSpeed()" title="Velocidade (< >)" aria-label="Velocidade">{{ speed() }}×</button>
          <button type="button" class="vp-btn" (click)="full()" aria-label="Tela cheia" title="Tela cheia (F)"><app-icon name="expand" [size]="15" /></button>
        </div>
      </div>
    </div>`,
  styles: [`
    .vp-btn { display: grid; place-items: center; height: 28px; min-width: 28px; padding: 0 6px; border-radius: 8px; }
    .vp-btn:hover { background: rgb(255 255 255 / .14); }
    .vp-range { appearance: none; background: transparent; }
    .vp-range::-webkit-slider-runnable-track { height: 16px; background: transparent; }
    .vp-range::-webkit-slider-thumb { appearance: none; width: 13px; height: 13px; margin-top: 1.5px; border-radius: 99px; background: #fff; box-shadow: 0 0 0 3px rgb(127 162 255 / .45); opacity: 0; transition: opacity .15s; }
    .group:hover .vp-range::-webkit-slider-thumb, .vp-range:focus-visible::-webkit-slider-thumb { opacity: 1; }
  `],
})
export class VideoPlayer {
  readonly src = input.required<string>();
  readonly label = input('Vídeo');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('v');
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  protected readonly playing = signal(false);
  protected readonly time = signal(0);
  protected readonly duration = signal(0);
  protected readonly buffered = signal(0);
  protected readonly speed = signal(1);
  protected readonly clock = clock;
  /** descobrindo a duração do webm (pulou para o fim de propósito) */
  private probing = false;

  private get v(): HTMLVideoElement { return this.video().nativeElement; }

  protected meta(): void {
    if (isFinite(this.v.duration)) { this.duration.set(this.v.duration); return; }
    // webm sem duração gravada: pular para muito longe faz o navegador ler o fim e descobrir quanto dura
    this.probing = true;
    this.v.currentTime = 1e101;
  }
  protected durationFix(): void {
    if (!isFinite(this.v.duration)) return;
    this.duration.set(this.v.duration);
    if (this.probing) { this.probing = false; this.v.currentTime = 0; }
  }
  protected tick(): void { if (!this.probing) this.time.set(this.v.currentTime); }
  protected buffer(): void {
    const b = this.v.buffered;
    if (b.length && this.duration()) this.buffered.set((b.end(b.length - 1) / this.duration()) * 100);
  }

  protected toggle(): void { if (this.v.paused) this.v.play().catch(() => {}); else this.v.pause(); }
  protected seek(t: number): void { this.v.currentTime = t; this.time.set(t); }
  protected jump(d: number): void { this.seek(Math.min(Math.max(0, this.v.currentTime + d), this.duration() || this.v.currentTime + d)); }
  protected nextSpeed(dir = 1): void {
    const i = (SPEEDS.indexOf(this.speed()) + dir + SPEEDS.length) % SPEEDS.length;
    this.speed.set(SPEEDS[i]);
    this.v.playbackRate = SPEEDS[i];
  }
  protected full(): void {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.box().nativeElement.requestFullscreen().catch(() => {});
  }

  /** atalhos só com o player em foco (não briga com os da Revisão: A aprova, R ajuste, ↑/↓ navegam) */
  protected key(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    const acts: Record<string, () => void> = {
      ' ': () => this.toggle(), k: () => this.toggle(), arrowleft: () => this.jump(-5), arrowright: () => this.jump(5),
      j: () => this.jump(-10), l: () => this.jump(10), f: () => this.full(), '<': () => this.nextSpeed(-1), '>': () => this.nextSpeed(1),
    };
    const act = acts[k];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  }
}
