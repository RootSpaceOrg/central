import { Component, computed, inject, signal } from '@angular/core';

import { McpServerDto } from '../../contract';
import { IpcService, errorMessage } from '../../services/ipc/ipc.service';
import { AskService } from '../../services/ask/ask.service';
import { AgoPipe } from '../../ui/ago.pipe';
import { Icon } from '../../ui/icon';
import { Select } from '../../ui/select';

const GROUPS: { kind: McpServerDto['kind']; label: string; hint: string }[] = [
  { kind: 'own', label: 'Seus servidores', hint: 'Adicionados por você (escopo do usuário). Valem para todos os agentes e sessões.' },
  { kind: 'connector', label: 'Conectores do claude.ai', hint: 'Geridos em claude.ai → Configurações → Conectores.' },
  { kind: 'plugin', label: 'De plugins', hint: 'Vêm dos plugins instalados no Claude Code.' },
];
const STATUS: Record<McpServerDto['status'], { label: string; cls: string }> = {
  connected: { label: 'Conectado', cls: 'bg-yes/15 text-yes' },
  auth: { label: 'Precisa autorizar', cls: 'bg-later/15 text-later' },
  failed: { label: 'Falhou', cls: 'bg-no/15 text-no' },
  unknown: { label: '?', cls: 'bg-raise text-mute' },
};

/** Preferências → MCPs: o que o Claude Code (e os agentes) enxerga, o status de cada um, adicionar e remover os seus. */
@Component({
  selector: 'app-mcp-settings',
  imports: [Icon, AgoPipe, Select],
  host: { class: 'block' },
  template: `
    <div class="flex items-center gap-3">
      <p class="flex-1 text-[13px] text-mute">
        @if (loading()) { Conferindo cada servidor… (leva uns segundos) }
        @else if (checkedAt()) { {{ list().length }} servidores, conferidos {{ checkedAt() | ago }}. }
      </p>
      <button type="button" class="btn btn-sm" (click)="load(true)" [disabled]="loading()"><app-icon name="sync" [size]="14" [class.animate-spin]="loading()" />Conferir de novo</button>
    </div>
    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-no/10 px-4 py-2.5 text-[13px] text-no">{{ error() }}</p> }
    @if (needsAuth()) {
      <p class="mt-3 rounded-xl border border-later/30 bg-later/10 px-4 py-2.5 text-[13px] leading-relaxed">
        <b class="text-later">{{ needsAuth() }} {{ needsAuth() === 1 ? 'precisa' : 'precisam' }} de autorização.</b>
        Abra um terminal, rode <code class="rounded bg-night px-1.5 font-mono">claude</code> e use <code class="rounded bg-night px-1.5 font-mono">/mcp</code> para entrar em cada um. Conectores do claude.ai também autorizam no site.</p>
    }

    @for (g of groups; track g.kind) {
      @let items = byKind()[g.kind];
      @if (items.length || g.kind === 'own') {
        <section class="mt-5">
          <h4 class="text-[13px] font-semibold">{{ g.label }} <span class="font-normal text-faint">{{ items.length }}</span></h4>
          <p class="text-[12px] text-faint">{{ g.hint }}</p>
          <ul class="mt-2 divide-y divide-edge rounded-2xl border border-edge">
            @for (m of items; track m.name) {
              <li class="flex items-center gap-3 px-4 py-2.5">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[13.5px] font-semibold">{{ m.name }}</p>
                  <p class="truncate font-mono text-[11.5px] text-faint" [title]="m.target">{{ m.target }}</p>
                </div>
                <span class="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold" [class]="status[m.status].cls">{{ status[m.status].label }}</span>
                <button type="button" class="shrink-0 rounded-lg px-2 py-1 font-mono text-[11.5px] text-mute hover:bg-raise hover:text-text" (click)="copy(m.tools_prefix)"
                        [title]="'Copiar ' + m.tools_prefix + ' (vai em Ferramentas extras de um agente)'">{{ copied() === m.tools_prefix ? 'copiado' : m.tools_prefix }}</button>
                @if (m.kind === 'own') {
                  <button type="button" class="grid size-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-raise hover:text-no" (click)="remove(m)" [attr.aria-label]="'Remover ' + m.name"><app-icon name="delete" [size]="14" /></button>
                }
              </li>
            } @empty {
              <li class="px-4 py-3 text-[13px] text-faint">{{ loading() ? 'Carregando…' : 'Nenhum ainda.' }}</li>
            }
          </ul>
        </section>
      }
    }

    <!-- adicionar -->
    <form class="mt-5 rounded-2xl border border-dashed border-edge p-4" (submit)="$event.preventDefault(); add()">
      <p class="flex items-center gap-2 text-[13.5px] font-semibold"><app-icon name="plus" [size]="14" />Adicionar servidor</p>
      <div class="mt-3 grid grid-cols-[160px_130px_minmax(0,1fr)] gap-2">
        <input class="field !py-1.5 text-[13px]" placeholder="nome (ex.: sentry)" aria-label="Nome" [value]="name()" (input)="name.set($any($event.target).value)">
        <app-select [compact]="true" [options]="types" [value]="type()" (valueChange)="type.set($any($event))" label="Tipo" [minWidth]="150" />
        <input class="field !py-1.5 font-mono text-[12.5px]" [placeholder]="type() === 'stdio' ? 'npx -y @pacote/mcp-server' : 'https://mcp.exemplo.com/mcp'" aria-label="URL ou comando"
               [value]="target()" (input)="target.set($any($event.target).value)">
      </div>
      <div class="mt-2 flex items-center gap-2">
        <span class="flex-1 text-[12px] text-faint">Fica no escopo do usuário. Depois, libere nos agentes que vão usar (Ferramentas extras) com o prefixo que aparece na lista.</span>
        <button class="btn btn-sm btn-primary" [disabled]="!name().trim() || !target().trim() || saving()">{{ saving() ? 'Adicionando…' : 'Adicionar' }}</button>
      </div>
    </form>
  `,
})
export class McpSettings {
  private readonly ipc = inject(IpcService);
  private readonly ask = inject(AskService);

  protected readonly groups = GROUPS;
  protected readonly status = STATUS;
  protected readonly types = [{ value: 'http', label: 'HTTP' }, { value: 'sse', label: 'SSE' }, { value: 'stdio', label: 'Comando (stdio)' }];
  protected readonly list = signal<McpServerDto[]>([]);
  protected readonly checkedAt = signal<Date | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly type = signal<'http' | 'sse' | 'stdio'>('http');
  protected readonly target = signal('');
  protected readonly byKind = computed(() => Object.fromEntries(GROUPS.map(g => [g.kind, this.list().filter(m => m.kind === g.kind)])) as Record<McpServerDto['kind'], McpServerDto[]>);
  protected readonly needsAuth = computed(() => this.list().filter(m => m.status === 'auth').length);

  constructor() { this.load(false); }

  protected async load(force: boolean): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.ipc.invoke('mcp:list', force);
      this.list.set(r.list);
      this.checkedAt.set(r.checked_at ? new Date(r.checked_at) : null);
    } catch (e) { this.error.set(errorMessage(e)); } finally { this.loading.set(false); }
  }

  protected async add(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.ipc.invoke('mcp:add', { name: this.name().trim(), type: this.type(), target: this.target().trim() });
      this.name.set(''); this.target.set('');
      await this.load(true);
    } catch (e) { this.error.set(errorMessage(e)); } finally { this.saving.set(false); }
  }

  protected async remove(m: McpServerDto): Promise<void> {
    if (!(await this.ask.confirm(`Remover o MCP ${m.name}?`, { message: 'Sai do Claude Code: nenhum agente ou sessão usa mais.', confirmLabel: 'Remover', danger: true }))) return;
    this.error.set(null);
    try { await this.ipc.invoke('mcp:remove', m.name); await this.load(true); } catch (e) { this.error.set(errorMessage(e)); }
  }

  protected copy(v: string): void {
    this.ipc.invoke('app:copy', v).then(() => { this.copied.set(v); setTimeout(() => { if (this.copied() === v) this.copied.set(null); }, 1500); });
  }
}
