import { Injectable, inject } from '@angular/core';

import { CommitDto } from '../../contract';
import { ActivityApiService } from './activity-api.service';

export interface Commit {
  repoPath: string;
  repoName: string;
  projectSlug: string;
  sha: string;
  shortSha: string;
  committedAt: Date;
  author: string;
  subject: string;
}

export interface CommitDay {
  label: string;
  commits: Commit[];
}

const toCommit = (d: CommitDto): Commit => ({
  repoPath: d.repo_path,
  repoName: d.repo_name,
  projectSlug: d.project_slug,
  sha: d.sha,
  shortSha: d.sha.slice(0, 7),
  committedAt: new Date(d.committed_at),
  author: d.author,
  subject: d.subject,
});

const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

function dayLabel(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  const s = dayFmt.format(d);
  return s[0].toUpperCase() + s.slice(1);
}

/** O que foi feito: commits de todos os repos, agrupados por dia. Só lê, sem estado. */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly api = inject(ActivityApiService);

  async byDay(slug: string | null, days: number, limit: number): Promise<CommitDay[]> {
    const commits = (await this.api.recent(slug, days, limit)).map(toCommit);
    const groups: CommitDay[] = [];
    for (const c of commits) {
      const label = dayLabel(c.committedAt);
      const last = groups.at(-1);
      if (last?.label === label) last.commits.push(c);
      else groups.push({ label, commits: [c] });
    }
    return groups;
  }
}
