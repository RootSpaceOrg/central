import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { ChatService } from '../../../../../../shared/services/chat/chat.service';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { RunsService } from '../../../../../../shared/services/runs/runs.service';
import { Run } from '../../../../../../shared/services/runs/runs.model';
import { ScopeService } from '../../../../../../shared/services/scope/scope.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { ProjectAvatar } from '../../../../../../shared/ui/project-avatar';

/** execução que precisa de você: esperando (login, acesso, resposta), falhou sem ninguém assumir, ou pausada */
export function needsYou(r: Run, runs: Run[]): boolean {
  if (r.dismissed) return false;
  if (r.waiting) return true;
  if (r.paused && r.status === 'queued') return true;
  return (r.status === 'failed' || r.status === 'killed') && !!r.sessionId && !runs.some(x => x.handoffFrom === r.id)
    && !runs.some(x => x.taskId && x.taskId === r.taskId && x.createdAt > r.createdAt);
}

/**
 * Triagem → "Esperando você": as execuções paradas por sua causa, com as ações ali mesmo (sem abrir a execução).
 * Esperando primeiro (trava agente), depois falhas, depois pausadas pelo freio.
 */
@Component({
  selector: 'app-waiting-runs',
  imports: [RouterLink, Icon, AgoPipe, ProjectAvatar],
  template: `
    @if (error()) { <p role="alert" class="mt-4 text-no">{{ error() }}</p> }
    <div class="mt-5 space-y-3">
      @for (r of list(); track r.id) {
        <article class="rounded-2xl border px-5 py-4" [class]="r.waiting ? 'border-later/50 bg-later/[0.07]' : 'border-edge bg-panel'" [attr.data-run]="r.id" [attr.data-project]="r.projectSlug">
          <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
            <span class="rounded-full px-2 py-px font-semibold" [class]="r.waiting ? 'bg-later/20 text-later' : r.paused ? 'bg-raise text-mute' : 'bg-no/15 text-no'">
              {{ r.waiting ? 'Esperando você' : r.paused ? 'Pausada' : r.status === 'killed' ? 'Interrompida' : 'Falhou' }}</span>
            @if (agent(r.agentId); as a) { <span class="flex items-center gap-1 font-semibold" [style.color]="a.color"><app-project-avatar [project]="a" [size]="14" />{{ a.name }}</span> }
            @if (project(r.projectSlug); as p) { <span class="flex items-center gap-1" [style.color]="p.color"><app-project-avatar [project]="p" [size]="14" />{{ p.name }}</span> }
            <span class="text-faint">· {{ (r.finishedAt ?? r.createdAt) | ago }}</span>
          </p>
          <h3 class="mt-1.5 line-clamp-2 font-display text-[16.5px] font-semibold leading-snug">{{ r.title }}</h3>

          @if (r.waiting; as w) {
            <p class="mt-2 text-[14px]"><span class="font-semibold text-later">O que falta:</span> {{ w.reason }}</p>
            @if (w.fix) { <p class="mt-0.5 text-[13.5px] text-mute">{{ w.fix }}</p> }
          } @else if (r.paused; as pz) {
            <p class="mt-2 text-[13.5px] text-mute">{{ pz.reason }}</p>
          } @else if (r.result) {
            <p class="mt-2 line-clamp-3 text-[13.5px] text-mute">{{ r.result }}</p>
          }

          <div class="mt-3 flex flex-wrap items-center gap-2">
            @if (r.waiting?.command; as cmd) {
              <button type="button" class="flex items-center gap-2 rounded-lg bg-night px-2.5 py-1 font-mono text-[12.5px] hover:bg-raise" (click)="copy(r.id, cmd)" title="Copiar o comando">
                {{ cmd }}<app-icon [name]="copied() === r.id ? 'check' : 'copy'" [size]="13" class="text-faint" /></button>
            }
            <span class="flex-1"></span>
            <a routerLink="/execucoes" [queryParams]="{ run: r.id }" class="btn btn-sm btn-ghost">Abrir execução</a>
            @if (r.waiting) {
              <button type="button" class="btn btn-sm btn-ghost" (click)="dismiss(r)" title="Tira o aviso sem retomar: a tarefa volta para a fila">Descartar a espera</button>
              <button type="button" class="btn btn-sm btn-primary" (click)="resume(r)" [disabled]="busy() === r.id" title="A mesma execução volta a rodar, na mesma sessão, de onde parou">Já resolvi, retomar</button>
            } @else if (r.paused) {
              <button type="button" class="btn btn-sm btn-ghost" (click)="act(r, runs.dismiss(r.id))" title="Não roda mais: sai daqui (continua no histórico)">Descartar</button>
              <button type="button" class="btn btn-sm btn-primary" (click)="act(r, runs.unpause(r.id))" [disabled]="busy() === r.id">Retomar agora</button>
            } @else {
              <button type="button" class="btn btn-sm btn-ghost" (click)="act(r, runs.dismiss(r.id))" title="Não precisa mais: sai daqui (continua no histórico)">Descartar</button>
              <button type="button" class="btn btn-sm btn-primary" (click)="act(r, runs.continue(r.id))" [disabled]="busy() === r.id" title="A mesma sessão do Claude, de onde parou">
                <app-icon name="play" [size]="13" />Continuar</button>
            }
          </div>
        </article>
      } @empty {
        <div class="mt-3 rounded-[28px] border-2 border-dashed border-edge px-6 py-16 text-center text-mute">Nenhum agente esperando você.</div>
      }
    </div>
  `,
})
export class WaitingRuns {
  protected readonly runs = inject(RunsService);
  private readonly agents = inject(AgentsService);
  private readonly projects = inject(ProjectsService);
  private readonly scope = inject(ScopeService);
  private readonly chat = inject(ChatService);

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<number | null>(null);
  protected readonly copied = signal<number | null>(null);

  protected readonly list = computed(() => {
    const all = this.runs.runs();
    const rank = (r: Run) => (r.waiting ? 0 : r.paused ? 2 : 1);
    return all.filter(r => needsYou(r, all) && this.scope.matches(r.projectSlug))
      .sort((a, b) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime());
  });

  protected agent(id: number | null) { return id ? this.agents.byId().get(id) ?? null : null; }
  protected project(slug: string | null) { return slug ? this.projects.bySlug().get(slug) ?? null : null; }

  protected copy(id: number, text: string): void {
    navigator.clipboard.writeText(text);
    this.copied.set(id);
    setTimeout(() => this.copied.set(null), 1500);
  }

  protected async act(r: Run, p: Promise<unknown>): Promise<void> {
    this.busy.set(r.id);
    this.error.set(null);
    try { await p; } catch (e) { this.error.set((e as Error).message); } finally { this.busy.set(null); }
  }
  protected resume(r: Run): void { this.act(r, this.runs.resume(r.id).then(id => { if (id) this.chat.openInPanel(id); })); }
  protected dismiss(r: Run): void { this.act(r, this.runs.dismissWaiting(r.id)); }
}
