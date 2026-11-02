import { Component, inject, model, output, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

import { ProjectIconKind } from '../../contract';
import { PROJECT_COLORS } from '../../services/projects/projects.model';
import { ProjectsService } from '../../services/projects/projects.service';
import { PROJECT_ICONS } from '../../ui/project-avatar';

const EMOJIS = ['🚀', '📚', '🎓', '🐾', '🏥', '💼', '🎨', '🛒', '📈', '🧠', '⚡', '🌱', '🏫', '🧩', '🎯', '🔧', '🛟', '🚨', '📣', '🤖'];

/** Ícone (letra, emoji, ícone da coleção ou imagem própria) e cor. Usado por projetos e agentes. */
@Component({
  selector: 'app-icon-picker',
  template: `
    <div class="space-y-5">
      <div>
        <span class="mb-2 block font-semibold">Ícone</span>
        <div class="mb-3 flex w-fit gap-1 rounded-full border border-edge bg-night p-1" role="tablist" aria-label="Tipo de ícone">
          @for (k of kinds; track k.id) {
            <button type="button" role="tab" [attr.aria-selected]="kind() === k.id" (click)="setKind(k.id)"
                    class="rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors"
                    [class]="kind() === k.id ? 'bg-raise text-text' : 'text-mute hover:text-text'">{{ k.label }}</button>
          }
        </div>
        @switch (kind()) {
          @case ('letter') { <p class="text-[13px] text-mute">A inicial do nome, na cor escolhida.</p> }
          @case ('emoji') {
            <div class="flex flex-wrap items-center gap-1.5">
              @for (e of emojis; track e) {
                <button type="button" (click)="value.set(e)" [attr.aria-label]="e" [attr.aria-pressed]="value() === e"
                        class="grid size-10 place-items-center rounded-xl text-xl transition hover:scale-110 hover:bg-raise"
                        [class.!bg-raise]="value() === e" [class.ring-2]="value() === e" [class.ring-frost]="value() === e">{{ e }}</button>
              }
              <input class="field !w-24 text-center text-xl" maxlength="4" aria-label="Outro emoji" placeholder="outro"
                     [value]="emojis.includes(value() ?? '') ? '' : value() ?? ''" (input)="value.set($any($event.target).value || null)">
            </div>
          }
          @case ('lucide') {
            <div class="grid grid-cols-9 gap-1.5">
              @for (i of icons; track i) {
                <button type="button" (click)="value.set(i)" [attr.aria-label]="i" [attr.aria-pressed]="value() === i" [title]="i"
                        class="grid aspect-square place-items-center rounded-xl text-mute transition hover:bg-raise hover:text-text"
                        [class.!bg-raise]="value() === i" [class.!text-text]="value() === i" [class.ring-2]="value() === i" [class.ring-frost]="value() === i">
                  <span class="size-5 [&>svg]:size-full" [innerHTML]="svg(i)"></span>
                </button>
              }
            </div>
          }
          @case ('image') {
            <div class="flex items-center gap-3">
              @if (value()) { <img [src]="value()" alt="" class="size-12 rounded-xl object-cover"> }
              <button type="button" class="btn" (click)="pickImage()">{{ value() ? 'Trocar imagem' : 'Enviar imagem' }}</button>
              <span class="text-[13px] text-mute">PNG, JPG, WebP ou SVG, até 400 KB.</span>
            </div>
          }
        }
        @if (error()) { <p role="alert" class="mt-2 text-[13px] text-no">{{ error() }}</p> }
      </div>

      <div>
        <span class="mb-2 block font-semibold">Cor</span>
        <div class="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Cor">
          @for (c of colors; track c) {
            <button type="button" role="radio" [attr.aria-checked]="color() === c" [attr.aria-label]="c" (click)="color.set(c)"
                    class="size-8 rounded-full ring-offset-2 ring-offset-panel transition hover:scale-110" [style.background]="c"
                    [class.ring-2]="color() === c" [class.ring-text]="color() === c"></button>
          }
          <label class="ml-1 flex cursor-pointer items-center gap-2 rounded-full border border-edge px-3 py-1 text-[13px] text-mute hover:text-text">
            <input type="color" class="size-5 cursor-pointer rounded border-0 bg-transparent p-0" [value]="color()" (input)="color.set($any($event.target).value)">
            Outra
          </label>
        </div>
      </div>
    </div>`,
})
export class IconPicker {
  private readonly projects = inject(ProjectsService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly kind = model<ProjectIconKind>('letter');
  readonly value = model<string | null>(null);
  readonly color = model<string>(PROJECT_COLORS[0]);
  readonly failed = output<string>();

  protected readonly emojis = EMOJIS;
  protected readonly icons = Object.keys(PROJECT_ICONS);
  protected readonly colors = PROJECT_COLORS;
  protected readonly error = signal<string | null>(null);
  protected readonly kinds: { id: ProjectIconKind; label: string }[] = [
    { id: 'letter', label: 'Letra' }, { id: 'emoji', label: 'Emoji' }, { id: 'lucide', label: 'Ícone' }, { id: 'image', label: 'Imagem' },
  ];

  // SVGs fixos do pacote, nunca vindos do usuário.
  protected svg(name: string) { return this.sanitizer.bypassSecurityTrustHtml(PROJECT_ICONS[name]); }

  protected setKind(kind: ProjectIconKind): void {
    if (kind === this.kind()) return;
    this.kind.set(kind);
    this.value.set(kind === 'emoji' ? EMOJIS[0] : kind === 'lucide' ? 'rocket' : null);
    if (kind === 'image') this.pickImage();
  }

  protected async pickImage(): Promise<void> {
    this.error.set(null);
    try {
      const img = await this.projects.pickImage();
      if (img) { this.kind.set('image'); this.value.set(img); }
      else if (!this.value()) this.kind.set('letter');
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
