import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Nome usado no app → glifo do Material Symbols Rounded (fonte embutida, sem rede). */
const GLYPHS = {
  home: 'home',
  overview: 'monitoring',
  inbox: 'how_to_vote',
  ideas: 'lightbulb',
  kanban: 'view_kanban',
  agent: 'smart_toy',
  plus: 'add',
  sync: 'sync',
  folder: 'folder',
  'folder-open': 'folder_open',
  file: 'draft',
  terminal: 'terminal',
  code: 'code',
  external: 'open_in_new',
  close: 'close',
  chevron: 'chevron_right',
  branch: 'fork_right',
  stop: 'stop_circle',
  play: 'play_arrow',
  check: 'check',
  pr: 'merge',
  summary: 'notes',
  spark: 'auto_awesome',
  night: 'bedtime',
  energy: 'bolt',
  low: 'battery_low',
  archive: 'archive',
  unarchive: 'unarchive',
  delete: 'delete',
  edit: 'edit',
  promote: 'arrow_upward',
  download: 'download',
  timer: 'schedule',
  more: 'more_horiz',
  flag: 'flag',
} as const;

export type IconName = keyof typeof GLYPHS;

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0 items-center justify-center', 'aria-hidden': 'true' },
  template: `<span class="material-symbols-rounded leading-none" [style.font-size.px]="size()"
    [style.font-variation-settings]="variation()">{{ glyph() }}</span>`,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  /** preenchido: usado no item ativo da navegação */
  readonly fill = input(false);

  protected readonly glyph = computed(() => GLYPHS[this.name()]);
  protected readonly variation = computed(() => `'FILL' ${this.fill() ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${Math.min(Math.max(this.size(), 20), 48)}`);
}
