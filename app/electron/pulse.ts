/**
 * Como a Central está indo, pelas duas medidas do Gustavo: histórias que ele validou (e as que voltaram) e o resultado dos
 * produtos (métricas que os donos registram com report_metric). Por projeto, com o dono e a última passada dele.
 */
import type { PulseDto } from '../src/app/shared/contract';
import { all, get, run } from './db';
import { OWNER_HEAD } from './owner';

export function reportMetric(slug: string, name: string, value: number, unit: string | null, note: string | null): string {
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error(`Projeto ${slug} não existe.`);
  if (!Number.isFinite(value)) throw new Error('Valor precisa ser um número.');
  run('insert into metrics (project_slug, name, value, unit, note) values (?,?,?,?,?)', slug, name.trim().slice(0, 60), value, unit?.trim().slice(0, 12) || null, note?.trim().slice(0, 300) || null);
  return `Registrado: ${name} = ${value}${unit ? ` ${unit}` : ''}.`;
}

/** o foco do rumo numa linha: a seção "Foco agora" (ou a primeira frase do rumo) */
export function focusOf(text: string | null): string | null {
  if (!text) return null;
  const clean = (l: string) => l.replace(/^[-*\d.)\s]+/, '').replace(/\*\*/g, '').trim();
  const lines = text.split('\n').map(l => l.trim());
  // "**Foco agora:** texto", "## Foco agora" ou "Foco agora:" seguido de lista
  const HEAD = /^#*\s*\**\s*foco(\s+agora)?\s*:?\s*\**\s*:?\s*/i;
  const at = lines.findIndex(l => HEAD.test(l));
  const next = (from: number) => lines.slice(from).find(l => l && !/^#/.test(l) && !/^\*\*[^*]+:\*\*$/.test(l));
  const raw = at >= 0 ? (clean(lines[at].replace(HEAD, '')) || clean(next(at + 1) ?? '')) : clean(next(0)?.replace(/^\**\s*objetivo\s*:?\s*\**\s*:?\s*/i, '') ?? '');
  return raw ? raw.slice(0, 180) : null;
}
const firstLine = (s: string) => s.split('\n').map(l => l.trim().replace(/^[-*]\s*/, '').replace(/\*\*/g, '')).find(l => l && !/^#/.test(l))?.slice(0, 200) ?? null;

export function pulse(): PulseDto {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const count = (action: string, slug?: string) => get<{ n: number }>(
    `select count(*) n from operator_actions where action = ? and at > ? ${slug ? 'and project_slug = ?' : ''}`, action, since, ...(slug ? [slug] : []))!.n;
  const projects = all<{ slug: string; name: string; color: string; owner_on: number; owner: string | null }>(
    `select p.slug, p.name, p.color, p.owner_on, a.name owner from projects p left join agents a on a.id = p.todo_agent_id
     where p.status in ('active','maintenance') order by p.position, p.name`);
  return {
    validated: count('história: accepted'),
    returned: count('história: adjusting'),
    projects: projects.map(p => {
      // a última leitura de cada métrica, com a anterior para mostrar a direção
      const names = all<{ name: string }>('select distinct name from metrics where project_slug = ?', p.slug).map(x => x.name);
      const metrics = names.map(n => {
        const [cur, prev] = all<{ value: number; unit: string | null; at: string; note: string | null }>(
          'select value, unit, at, note from metrics where project_slug = ? and name = ? order by id desc limit 2', p.slug, n);
        return { name: n, value: cur.value, unit: cur.unit, at: cur.at, note: cur.note, prev: prev?.value ?? null };
      }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4);
      const last = get<{ at: string; status: string }>(`select created_at at, status from runs where project_slug = ? and prompt like ? order by id desc limit 1`, p.slug, `${OWNER_HEAD}%`);
      const diary = last ? get<{ r: string | null }>(`select result r from runs where project_slug = ? and prompt like ? and result is not null order by id desc limit 1`, p.slug, `${OWNER_HEAD}%`)?.r : null;
      return {
        slug: p.slug, name: p.name, color: p.color, owner: p.owner, owner_on: !!p.owner_on,
        focus: focusOf(get<{ text: string }>('select text from directions where project_slug = ? order by id desc limit 1', p.slug)?.text ?? null),
        diary: diary ? firstLine(diary) : null,
        to_validate: get<{ n: number }>(`select count(*) n from deliveries d join tasks t on t.id = d.task_id where d.status = 'review' and t.project_slug = ? and exists (select 1 from tasks c where c.parent_id = t.id)`, p.slug)!.n,
        validated: count('história: accepted', p.slug), returned: count('história: adjusting', p.slug),
        stories_open: get<{ n: number }>(`select count(*) n from tasks t where t.project_slug = ? and t."column" <> 'done' and exists (select 1 from tasks c where c.parent_id = t.id)`, p.slug)!.n,
        last_pass_at: last?.at ?? null, metrics,
      };
    }),
  };
}
