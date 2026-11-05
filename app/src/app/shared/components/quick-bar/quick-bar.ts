import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';

import { AgentsService } from '../../services/agents/agents.service';
import { ContextMenuService } from '../../services/context-menu/context-menu.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { QuickCommand, QuickCommandsService } from '../../services/quick-commands/quick-commands.service';
import { Icon } from '../../ui/icon';
import { Select, SelectOption } from '../../ui/select';
import { AgentSelect } from '../pickers/agent-select';
import { ProjectSelect } from '../pickers/project-select';

const SHELLS: { id: QuickCommand['shell']; label: string }[] = [{ id: 'shell', label: 'PowerShell' }, { id: 'bash', label: 'Git Bash' }, { id: 'cmd', label: 'CMD' }];
const blank = (): QuickCommand => ({ id: '', label: '', action: 'terminal', command: '', enter: true, project: null, shell: 'shell', agentId: null });

/**
 * Comandos rápidos na barra de título (como no Orca): um clique roda (terminal no projeto ou mensagem para um agente).
 * Botão direito edita ou remove; "+" cria.
 */
@Component({
  selector: 'app-quick-bar',
  imports: [Icon, Select, AgentSelect, ProjectSelect],
  host: { class: 'no-drag flex min-w-0 items-center gap-1' },
  template: `
    @for (c of qc.commands(); track c.id) {
      <button type="button" class="flex max-w-[190px] items-center gap-1.5 rounded-md border border-edge bg-panel px-2 py-0.5 text-[12px] text-mute transition hover:border-faint hover:text-text"
              (click)="qc.run(c)" (contextmenu)="menu($event, c)" [title]="(c.action === 'agent' ? 'Agente: ' : '') + c.command + ' (botão direito: editar)'">
        @if (c.action === 'agent') { <app-icon name="agent" [size]="12" class="shrink-0 text-frost" /> } @else { <app-icon name="play" [size]="11" class="shrink-0 text-yes" /> }
        <span class="truncate">{{ c.label }}</span>
      </button>
    }
    <button type="button" class="rounded-md p-1 text-faint transition hover:bg-raise hover:text-text" (click)="edit(null)" title="Novo comando rápido" aria-label="Novo comando rápido">
      <app-icon name="plus" [size]="14" /></button>
    @if (qc.error()) { <span role="alert" class="max-w-[260px] truncate text-[12px] text-no" [title]="qc.error()!">{{ qc.error() }}</span> }

    <dialog #dlg (close)="draft.set(null)" aria-labelledby="qc-title" class="no-drag m-auto w-[min(720px,94vw)] rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      @if (draft(); as d) {
        <form class="flex flex-col" (submit)="save($event)" (keydown.control.enter)="save($event)">
          <div class="space-y-5 px-8 pt-7 pb-6">
            <div>
              <h2 id="qc-title" class="font-display text-xl font-semibold">{{ d.id ? 'Editar comando rápido' : 'Novo comando rápido' }}</h2>
              <p class="mt-0.5 text-[13px] text-mute">Fica no topo do app para rodar com um clique.</p>
            </div>
            <div class="grid grid-cols-[1fr_auto] items-end gap-4">
              <label class="block">
                <span class="mb-1.5 block font-semibold">Nome</span>
                <input class="field" placeholder="Ex.: Login AWS" [value]="d.label" (input)="patch({ label: $any($event.target).value })" required autofocus>
              </label>
              <div>
                <span class="mb-1.5 block font-semibold">Ação</span>
                <div class="flex gap-1 rounded-xl border border-edge bg-night p-1" role="radiogroup" aria-label="Ação">
                  @for (a of actions; track a.id) {
                    <button type="button" role="radio" [attr.aria-checked]="d.action === a.id" (click)="patch({ action: a.id })"
                            class="rounded-lg px-4 py-1.5 text-[13px] font-semibold" [class]="d.action === a.id ? 'bg-raise' : 'text-mute hover:text-text'">{{ a.label }}</button>
                  }
                </div>
              </div>
            </div>
            <div class="overflow-hidden rounded-2xl border border-edge bg-night">
              <p class="border-b border-edge px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{{ d.action === 'agent' ? 'Mensagem para o agente' : 'Comando' }}</p>
              <textarea class="block h-40 w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] outline-none" aria-label="Comando"
                        [placeholder]="d.action === 'agent' ? 'Ex.: veja os PRs abertos do KultivAi e me diga o que está parado' : 'Ex.: aws sso login --profile mkt-platform'"
                        [value]="d.command" (input)="patch({ command: $any($event.target).value })" required></textarea>
              @if (d.action === 'terminal') {
                <label class="flex cursor-pointer items-center gap-2 border-t border-edge px-4 py-2 text-[12.5px] text-mute">
                  <input type="checkbox" class="accent-[var(--color-frost)]" [checked]="d.enter" (change)="patch({ enter: $any($event.target).checked })" />
                  Apertar Enter no fim (roda na hora)
                </label>
              }
            </div>
            <details class="text-[13.5px]" [open]="advanced()">
              <summary class="cursor-pointer font-semibold">Avançado <span class="font-normal text-faint">· {{ whereLabel() }}</span></summary>
              <div class="mt-3 grid grid-cols-2 gap-3">
                @if (d.action === 'terminal') {
                  <div><span class="mb-1 block text-mute">Projeto (pasta do terminal)</span>
                    <app-project-select [value]="d.project ?? ''" (valueChange)="patch({ project: $event || null })" noneLabel="O projeto aberto na tela" /></div>
                  <div><span class="mb-1 block text-mute">Terminal</span>
                    <app-select [options]="shells" [value]="d.shell" (valueChange)="patch({ shell: $any($event) })" label="Terminal" /></div>
                } @else {
                  <div><span class="mb-1 block text-mute">Agente</span>
                    <app-agent-select [hideCentral]="true" [value]="d.agentId ? '' + d.agentId : ''" (valueChange)="patch({ agentId: $event ? +$event : null })" noneLabel="Central" /></div>
                }
              </div>
            </details>
          </div>
          <footer class="flex items-center gap-3 border-t border-edge px-8 py-4">
            <span class="flex-1"></span>
            <button type="button" class="btn btn-ghost" (click)="close()">Cancelar</button>
            <button class="btn btn-primary" [disabled]="!d.label.trim() || !d.command.trim()">Salvar <kbd class="ml-1 text-[11px] opacity-60">Ctrl+Enter</kbd></button>
          </footer>
        </form>
      }
    </dialog>
  `,
})
export class QuickBar {
  protected readonly qc = inject(QuickCommandsService);
  protected readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);
  private readonly ctx = inject(ContextMenuService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly shells: SelectOption[] = SHELLS.map(s => ({ value: s.id, label: s.label }));
  protected readonly actions = [{ id: 'terminal', label: 'Terminal' }, { id: 'agent', label: 'Agente' }] as const;
  protected readonly draft = signal<QuickCommand | null>(null);
  protected readonly advanced = signal(false);
  protected readonly whereLabel = computed(() => {
    const d = this.draft();
    if (!d) return '';
    if (d.action === 'agent') return d.agentId ? this.agents.byId().get(d.agentId)?.name ?? 'agente' : 'Central';
    return `${d.project ? this.projects.bySlug().get(d.project)?.name ?? d.project : 'projeto aberto'} · ${SHELLS.find(s => s.id === d.shell)?.label}`;
  });

  constructor() {
    effect(() => {
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (this.draft() && !el.open) el.showModal();
      if (!this.draft() && el.open) el.close();
    });
  }

  protected edit(c: QuickCommand | null): void {
    this.advanced.set(!!c && (c.project !== null || c.shell !== 'shell' || c.agentId !== null));
    this.draft.set(c ? { ...c } : blank());
  }

  protected patch(p: Partial<QuickCommand>): void { this.draft.update(d => (d ? { ...d, ...p } : d)); }

  protected close(): void { this.draft.set(null); }

  protected save(e: Event): void {
    e.preventDefault();
    const d = this.draft();
    if (!d?.label.trim() || !d.command.trim()) return;
    this.qc.save({ ...d, id: d.id || crypto.randomUUID(), label: d.label.trim(), command: d.command.trim() });
    this.close();
  }

  protected menu(e: MouseEvent, c: QuickCommand): void {
    this.ctx.open(e, [
      { label: 'Rodar', icon: 'play', run: () => this.qc.run(c) },
      { label: 'Editar', icon: 'edit', run: () => this.edit(c) },
      null,
      { label: 'Remover', icon: 'delete', danger: true, run: () => this.qc.remove(c.id) },
    ]);
  }
}
