import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';

import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { IconPicker } from '../../../../shared/components/pickers/icon-picker';
import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { ProjectIconKind, RunPermission } from '../../../../shared/contract';
import { Agent, AgentsService, MODELS, ROOM_CHOICES, TOOL_SUGGESTIONS } from '../../../../shared/services/agents/agents.service';
import { ACCESSORIES, AvatarLook, HAIR_STYLES, LOOK_DEFAULT, SKINS } from '../../../../shared/ui/avatar-look';
import type { AvatarPreview } from '../../../../shared/ui/avatar3d';
import { Icon } from '../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../shared/ui/project-avatar';

/** null fechado; agent null = novo agente. */
export type AgentDialogState = { agent: Agent | null; projectSlug?: string | null } | null;

@Component({
  selector: 'app-agent-dialog',
  imports: [Icon, IconPicker, ProjectSelect, ProjectAvatar],
  templateUrl: './agent-dialog.html',
})
export class AgentDialog {
  private readonly agents = inject(AgentsService);
  private readonly projects = inject(ProjectsService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private readonly previewEl = viewChild<ElementRef<HTMLElement>>('preview');

  readonly state = input<AgentDialogState>(null);
  readonly closed = output<number | null>();

  protected readonly models = MODELS;
  protected readonly tabs = [{ id: 'papel', label: 'Papel' }, { id: 'trabalho', label: 'Trabalho' }, { id: 'aparencia', label: 'Aparência' }] as const;
  protected readonly tab = signal<'papel' | 'trabalho' | 'aparencia'>('papel');
  protected readonly hairStyles = HAIR_STYLES;
  protected readonly accessories = ACCESSORIES;
  protected readonly skins = SKINS;
  protected readonly look = signal<AvatarLook>(LOOK_DEFAULT);
  private previewer: AvatarPreview | null = null;
  protected readonly suggestions = TOOL_SUGGESTIONS;

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly color = signal('#7FA2FF');
  protected readonly iconKind = signal<ProjectIconKind>('emoji');
  protected readonly iconValue = signal<string | null>('🤖');
  protected readonly projectSlug = signal('');
  protected readonly instructions = signal('');
  protected readonly tools = signal<string[]>([]);
  protected readonly toolInput = signal('');
  protected readonly permission = signal<RunPermission>('edits');
  protected readonly priority = signal<'high' | 'normal' | 'low'>('normal');
  protected readonly priorities = [
    { value: 'high' as const, label: 'Alta', hint: 'Passa à frente na fila e segue trabalhando até 90% da sessão. Para quem atende urgência (suporte, incidentes).' },
    { value: 'normal' as const, label: 'Normal', hint: 'Ordem de chegada; para de começar em 80% da sessão.' },
    { value: 'low' as const, label: 'Baixa', hint: 'Só quando sobra cota: para de começar em 60% da sessão.' },
  ];
  protected readonly priorityHint = () => this.priorities.find(p => p.value === this.priority())!.hint;
  protected readonly model = signal('');
  protected readonly room = signal('');
  protected readonly rooms = ROOM_CHOICES;
  protected readonly confirmDelete = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly agent = computed(() => this.state()?.agent ?? null);
  protected readonly builtin = computed(() => !!this.agent()?.builtin);
  protected readonly preview = computed(() => ({ name: this.name() || '?', color: this.color(), iconKind: this.iconKind(), iconValue: this.iconValue() }));
  protected readonly freeSuggestions = computed(() => this.suggestions.filter(s => !this.tools().includes(s.value)));

  constructor() {
    // prévia 3D só quando a aba Aparência está aberta (o three.js carrega sob demanda)
    effect(() => {
      const el = this.previewEl()?.nativeElement;
      const look = this.look(), hair = this.color(), shirt = this.projects.bySlug().get(this.projectSlug())?.color ?? '#6b7385';
      if (!el) { this.previewer?.destroy(); this.previewer = null; return; }
      if (this.previewer) { this.previewer.show(hair, shirt, SKINS[1], look); return; }
      import('../../../../shared/ui/avatar3d').then(({ AvatarPreview }) => {
        if (this.previewer || !this.previewEl()) return;
        this.previewer = new AvatarPreview(el);
        this.previewer.show(this.color(), shirt, SKINS[1], this.look());
      });
    });
    inject(DestroyRef).onDestroy(() => this.previewer?.destroy());
    effect(() => {
      const s = this.state();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (s && !el.open) { this.fill(s.agent); if (!s.agent && s.projectSlug) this.projectSlug.set(s.projectSlug); el.showModal(); }
      if (!s && el.open) el.close();
    });
  }

  protected addTool(value = this.toolInput()): void {
    const v = value.trim();
    if (v && !this.tools().includes(v)) this.tools.update(t => [...t, v]);
    this.toolInput.set('');
  }

  protected setLook(patch: Partial<AvatarLook>): void { this.look.update(l => ({ ...l, ...patch })); }

  protected removeTool(v: string): void { this.tools.update(t => t.filter(x => x !== v)); }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.name().trim()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = await this.agents.save(this.agent()?.id ?? null, {
        name: this.name().trim(), description: this.description().trim() || null, color: this.color(), iconKind: this.iconKind(),
        iconValue: this.iconValue(), projectSlug: this.projectSlug() || null, instructions: this.instructions(), tools: this.tools(),
        permission: this.permission(), priority: this.priority(), model: this.model(), room: this.room(), look: this.look(),
      });
      this.closed.emit(saved.id);
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const a = this.agent();
    if (!a) return;
    this.busy.set(true);
    try {
      await this.agents.remove(a.id);
      this.closed.emit(null);
    } catch (err) {
      this.error.set((err as Error).message);
      this.busy.set(false);
    }
  }

  private fill(a: Agent | null): void {
    this.name.set(a?.name ?? ''); this.description.set(a?.description ?? ''); this.color.set(a?.color ?? '#7FA2FF');
    this.iconKind.set(a?.iconKind ?? 'emoji'); this.iconValue.set(a ? a.iconValue : '🤖'); this.projectSlug.set(a?.projectSlug ?? '');
    this.instructions.set(a?.instructions ?? ''); this.tools.set(a?.tools ?? []); this.permission.set(a?.permission ?? 'edits'); this.priority.set(a?.priority ?? 'normal');
    this.model.set(a?.model ?? ''); this.room.set(a?.room ?? ''); this.look.set(a?.look ?? LOOK_DEFAULT); this.tab.set('papel'); this.toolInput.set(''); this.confirmDelete.set(false); this.error.set(null); this.busy.set(false);
  }
}
