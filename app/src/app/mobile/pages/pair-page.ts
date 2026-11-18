import { Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { pair } from '../bridge';

/** parear este celular: o código de 6 dígitos que aparece no PC (Utils > Celular), digitado ou vindo do QR */
@Component({
  selector: 'app-mobile-pair',
  host: { class: 'grid min-h-full place-items-center px-6 py-10' },
  template: `
    <div class="w-full max-w-sm text-center">
      <img src="logo.png" alt="" class="mx-auto size-16 rounded-2xl" />
      <h1 class="mt-4 font-display text-[26px] font-bold">Central no celular</h1>
      <p class="mt-2 text-[14px] leading-relaxed text-mute">No PC, abra <b class="text-text">Utils › Celular</b> e use o código de 6 dígitos (ou leia o QR com a câmera).</p>
      <input class="field mt-6 text-center font-display text-[30px] tracking-[0.3em]" inputmode="numeric" maxlength="6" placeholder="000000"
             [value]="value()" (input)="value.set($any($event.target).value.replace(/\\D/g, ''))" (keydown.enter)="go()" aria-label="Código de pareamento" />
      <input class="field mt-3 text-[15px]" [value]="name()" (input)="name.set($any($event.target).value)" aria-label="Nome deste aparelho" placeholder="Nome deste aparelho" />
      <button type="button" class="btn btn-primary mt-4 w-full justify-center py-3 text-[16px]" [disabled]="value().length !== 6 || busy()" (click)="go()">{{ busy() ? 'Pareando…' : 'Parear' }}</button>
      @if (error(); as e) { <p role="alert" class="mt-3 text-[14px] text-no">{{ e }}</p> }
      <p class="mt-8 text-[12px] leading-relaxed text-faint">A conexão passa só pelo Tailscale (rede privada entre o seu PC e este celular). Daqui dá para decidir, usar as entregas, responder o 1:1 e conversar com os agentes.</p>
    </div>`,
})
export class PairPage {
  readonly code = input<string>('');
  private readonly router = inject(Router);
  protected readonly value = signal('');
  protected readonly name = signal(/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Celular');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void { if (this.code()) { this.value.set(this.code()); this.go(); } }

  protected async go(): Promise<void> {
    if (this.value().length !== 6) return;
    this.busy.set(true); this.error.set(null);
    const err = await pair(this.value(), this.name().trim() || 'Celular');
    this.busy.set(false);
    if (err) { this.error.set(err); return; }
    location.replace(location.pathname + '#/');
    location.reload();
  }
}
