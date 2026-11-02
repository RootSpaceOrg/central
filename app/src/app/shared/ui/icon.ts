import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  Activity, Archive, ArchiveRestore, ArrowUpFromLine, Bot, ChartNoAxesColumn, Check, ChevronRight, CircleStop, Clock, Code, Download,
  Ellipsis, ExternalLink, File, Flag, Folder, FolderOpen, GitBranch, GitMerge, House, Inbox, KanbanSquare, Lightbulb,
  ListTree, MessageSquare, Moon, Pencil, Play, Plus, RefreshCw, Repeat, Send, Settings, Sparkles, SquareTerminal, Trash2,
  BatteryLow, Zap, X, LayoutGrid, Maximize2, Minimize2, Columns2, Rows2, GripVertical, Waypoints,
} from 'lucide-static';

/** Nome usado no app → SVG do Lucide (strings estáticas do pacote, sem rede). */
const SVGS = {
  home: House,
  activity: Activity,
  overview: ChartNoAxesColumn,
  inbox: Inbox,
  ideas: Lightbulb,
  kanban: KanbanSquare,
  agent: Bot,
  central: MessageSquare,
  routine: Repeat,
  plus: Plus,
  sync: RefreshCw,
  folder: Folder,
  'folder-open': FolderOpen,
  file: File,
  terminal: SquareTerminal,
  code: Code,
  external: ExternalLink,
  close: X,
  chevron: ChevronRight,
  branch: GitBranch,
  stop: CircleStop,
  play: Play,
  check: Check,
  pr: GitMerge,
  summary: ListTree,
  spark: Sparkles,
  night: Moon,
  energy: Zap,
  low: BatteryLow,
  archive: Archive,
  unarchive: ArchiveRestore,
  delete: Trash2,
  edit: Pencil,
  promote: ArrowUpFromLine,
  download: Download,
  timer: Clock,
  more: Ellipsis,
  flag: Flag,
  send: Send,
  settings: Settings,
  grid: LayoutGrid,
  focus: Maximize2,
  unfocus: Minimize2,
  splitRight: Columns2,
  splitDown: Rows2,
  grip: GripVertical,
  graph: Waypoints,
} as const;

export type IconName = keyof typeof SVGS;

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex shrink-0 items-center justify-center [&>svg]:size-full',
    'aria-hidden': 'true',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.--sw]': 'stroke()',
    '[innerHTML]': 'svg()',
  },
  styles: [':host ::ng-deep svg { stroke-width: var(--sw); }'],
  template: '',
})
export class Icon {
  private readonly sanitizer = inject(DomSanitizer);

  readonly name = input.required<IconName>();
  readonly size = input(20);
  /** destaque (item ativo): traço mais grosso */
  readonly fill = input(false);

  protected readonly stroke = computed(() => (this.fill() ? 2.25 : 1.75));
  // SVGs fixos do pacote, nunca vindos do usuário: seguro marcar como confiável.
  protected readonly svg = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(SVGS[this.name()]));
}
