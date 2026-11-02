import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';

import { IconPicker } from '../../../../shared/components/pickers/icon-picker';
import { ProjectSelect } from '../../../../shared/components/pickers/project-select';
import { ProjectIconKind, RunPermission } from '../../../../shared/contract';
import { Agent, AgentsService, MODELS, ROOM_CHOICES, TOOL_SUGGESTIONS } from '../../../../shared/services/agents/agents.service';
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
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  readonly state = input<AgentDialogState>(null);
  readonly closed = output<number | null>();

  protected readonly models = MODELS;
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
        permission: this.permission(), model: this.model(), room: this.room(),
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
    this.instructions.set(a?.instructions ?? ''); this.tools.set(a?.tools ?? []); this.permission.set(a?.permission ?? 'edits');
    this.model.set(a?.model ?? ''); this.room.set(a?.room ?? ''); this.toolInput.set(''); this.confirmDelete.set(false); this.error.set(null); this.busy.set(false);
  }
}
