import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  BookOpen, Briefcase, Building2, Camera, ChartLine, Code, Coffee, Database, Gamepad2, Globe, GraduationCap, HeartPulse, Leaf,
  Megaphone, Music, Package, Palette, PawPrint, Rocket, School, Shield, ShoppingCart, Sparkles, Store, Users, Wrench,
} from 'lucide-static';

/** Ícones que dá para escolher para um projeto (nome em kebab-case → SVG). */
export const PROJECT_ICONS: Record<string, string> = {
  rocket: Rocket, briefcase: Briefcase, 'graduation-cap': GraduationCap, school: School, 'book-open': BookOpen,
  'shopping-cart': ShoppingCart, store: Store, 'heart-pulse': HeartPulse, 'paw-print': PawPrint, palette: Palette,
  camera: Camera, megaphone: Megaphone, 'chart-line': ChartLine, code: Code, database: Database, globe: Globe,
  leaf: Leaf, 'building-2': Building2, users: Users, sparkles: Sparkles, 'gamepad-2': Gamepad2, music: Music,
  coffee: Coffee, shield: Shield, package: Package, wrench: Wrench,
};

export interface AvatarSource {
  name: string;
  color: string;
  iconKind: 'letter' | 'emoji' | 'lucide' | 'image';
  iconValue: string | null;
}

/** Ícone de um projeto: letra na cor do projeto, emoji, ícone ou imagem. */
@Component({
  selector: 'app-project-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-grid shrink-0 place-items-center overflow-hidden font-display font-bold leading-none',
    '[style.width.px]': 'size()', '[style.height.px]': 'size()',
    '[style.border-radius.px]': 'size() * 0.28',
    '[style.font-size.px]': 'size() * 0.48',
    '[style.background]': 'kind() === "image" ? "transparent" : kind() === "letter" ? project().color : project().color + "26"',
    '[style.color]': 'kind() === "letter" ? "#141922" : project().color',
    'aria-hidden': 'true',
  },
  template: `
    @switch (kind()) {
      @case ('image') { <img [src]="project().iconValue" alt="" class="size-full object-cover"> }
      @case ('emoji') { <span [style.font-size.px]="size() * 0.6">{{ project().iconValue }}</span> }
      @case ('lucide') { <span class="grid place-items-center [&>svg]:size-full" [style.width.px]="size() * 0.6" [style.height.px]="size() * 0.6" [innerHTML]="svg()"></span> }
      @default { {{ letter() }} }
    }`,
})
export class ProjectAvatar {
  private readonly sanitizer = inject(DomSanitizer);

  readonly project = input.required<AvatarSource>();
  readonly size = input(24);

  protected readonly kind = computed(() => {
    const p = this.project();
    if (p.iconKind === 'lucide' && !PROJECT_ICONS[p.iconValue ?? '']) return 'letter';
    return p.iconKind !== 'letter' && !p.iconValue ? 'letter' : p.iconKind;
  });
  protected readonly letter = computed(() => this.project().name.trim()[0]?.toUpperCase() ?? '?');
  // SVGs fixos do pacote, nunca vindos do usuário.
  protected readonly svg = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(PROJECT_ICONS[this.project().iconValue ?? ''] ?? ''));
}
