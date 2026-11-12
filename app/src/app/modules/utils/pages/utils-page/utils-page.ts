import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { Icon, IconName } from '../../../../shared/ui/icon';
import { PullRequests } from './components/pull-requests/pull-requests';

type Tab = 'pull-requests';
const TABS: { id: Tab; label: string; icon: IconName }[] = [{ id: 'pull-requests', label: 'Pull Requests', icon: 'pullRequest' }];

/** Utils: ferramentas do dia a dia, uma por aba (?aba=). A primeira: os pull requests abertos que envolvem você. */
@Component({
  selector: 'app-utils-page',
  imports: [Icon, PullRequests],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    <header class="shrink-0 border-b border-edge px-8 pt-7">
      <h1 class="font-display text-[30px] font-bold leading-tight tracking-tight">Utils</h1>
      <nav class="mt-4 flex gap-6" role="tablist" aria-label="Ferramentas">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === t.id" (click)="go(t.id)"
                  class="-mb-px flex items-center gap-2 border-b-2 pb-3 font-semibold"
                  [class]="tab() === t.id ? 'border-frost text-text' : 'border-transparent text-mute hover:text-text'">
            <app-icon [name]="t.icon" [size]="15" />{{ t.label }}</button>
        }
      </nav>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-16">
      @if (tab() === 'pull-requests') { <app-pull-requests /> }
    </div>`,
})
export class UtilsPage {
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly tabs = TABS;
  protected readonly tab = computed<Tab>(() => (TABS.find(t => t.id === this.query()?.get('aba'))?.id ?? 'pull-requests'));
  protected go(t: Tab): void { this.router.navigate([], { queryParams: { aba: t }, replaceUrl: true }); }
}
