/**
 * Cockpit: a tela que fica aberta o dia todo. Os produtos por empresa (empresa = projeto de cima; produtos = ele mesmo, se
 * tem vida própria, e as frentes), e de cada produto os instrumentos: o dono e o estado dele, o rumo e a meta do marco
 * atual, o ritmo (14 dias), os números combinados, alertas e o que espera o Gustavo.
 */
import type { CockpitDto, CockpitProduct } from '../src/app/shared/contract';
import { all, get } from './db';
import { listMetricDefs } from './metrics';
import { OWNER_HEAD } from './owner';
import { focusOf } from './pulse';

const DAY = 86_400_000;

function product(p: { slug: string; name: string; color: string; icon_kind: string; icon_value: string | null; parent_slug: string | null;
  todo_agent_id: number | null; owner_agent_id: number | null; owner_on: number; one_on_one: string | null; one_on_one_at: string | null }): CockpitProduct {
  const s = p.slug;
  const ownerId = p.owner_agent_id ?? p.todo_agent_id;
  const owner = ownerId ? get<{ id: number; name: string; color: string; icon_kind: string; icon_value: string | null }>(
    'select id, name, color, icon_kind, icon_value from agents where id = ?', ownerId) ?? null : null;
  const tech = p.todo_agent_id ? get<{ id: number; name: string }>('select id, name from agents where id = ?', p.todo_agent_id) ?? null : null;
  const active = get<{ n: number }>(`select count(*) n from runs where project_slug = ? and status in ('queued','preparing','running')`, s)!.n;
  const ownerBusy = owner ? !!get(`select 1 from runs where project_slug = ? and agent_id = ? and status in ('queued','preparing','running')`, s, owner.id) : false;
  const waiting = get<{ n: number }>(`select count(*) n from proposals where project_slug = ? and status = 'proposed'`, s)!.n;
  const toValidate = get<{ n: number }>(`select count(*) n from deliveries d join tasks t on t.id = d.task_id where d.status = 'review' and t.project_slug = ?
    and exists (select 1 from tasks c where c.parent_id = t.id)`, s)!.n;
  // marco de agora: o primeiro em "Agora" (progresso pelas tarefas e histórias ligadas a ele)
  const ms = get<{ id: number; title: string; target: string | null }>(`select id, title, target from milestones where project_slug = ? and horizon = 'now' and done_at is null order by position limit 1`, s);
  const msCount = ms ? get<{ n: number; done: number }>(`select count(*) n, sum("column" in ('dev','done')) done from tasks where milestone_id = ? and parent_id is null`, ms.id)! : null;
  // ritmo: o que chegou em Feito/Em dev por dia (histórias e tarefas soltas; partes não contam)
  const since = new Date(Date.now() - 13 * DAY).toISOString().slice(0, 10);
  const doneDays = all<{ d: string; n: number }>(`select substr(updated_at, 1, 10) d, count(*) n from tasks where project_slug = ? and parent_id is null
    and "column" in ('dev','done') and substr(updated_at, 1, 10) >= ? group by 1`, s, since);
  const days = Array.from({ length: 14 }, (_, i) => doneDays.find(x => x.d === new Date(Date.now() - (13 - i) * DAY).toISOString().slice(0, 10))?.n ?? 0);
  const week = new Date(Date.now() - 7 * DAY).toISOString();
  const op = (action: string) => get<{ n: number }>('select count(*) n from operator_actions where project_slug = ? and action = ? and at > ?', s, action, week)!.n;
  // números: os combinados (com meta) e os que o dono registrou sem combinar
  const defs = listMetricDefs(s).filter(d => d.active);
  const names = [...new Set([...defs.map(d => d.name), ...all<{ name: string }>('select distinct name from metrics where project_slug = ?', s).map(x => x.name)])];
  const metrics = names.map(n => {
    const [cur, prev] = all<{ value: number; unit: string | null; at: string }>('select value, unit, at from metrics where project_slug = ? and name = ? order by id desc limit 2', s, n);
    const d = defs.find(x => x.name === n);
    return { name: n, unit: d?.unit ?? cur?.unit ?? null, value: cur?.value ?? null, prev: prev?.value ?? null, target: d?.target ?? null, at: cur?.at ?? null, every_hours: d?.every_hours ?? null };
  }).slice(0, 6);
  const diary = get<{ at: string; result: string | null }>(`select created_at at, result from runs where project_slug = ? and prompt like ? and result is not null order by id desc limit 1`, s, `${OWNER_HEAD}%`);
  const firstLine = (t: string) => t.split('\n').map(l => l.trim().replace(/^[-*]\s*/, '').replace(/\*\*/g, '')).find(l => l && !/^#/.test(l))?.slice(0, 220) ?? null;
  const alerts = all<{ id: number; summary: string; at: string }>(`select id, summary, created_at at from alerts where project_slug = ? and resolved_at is null order by id desc`, s);
  const returned = get<{ n: number }>(`select count(*) n from events where project_slug = ? and kind = 'historia_devolvida' and handled_at is null`, s)!.n;
  return {
    slug: s, name: p.name, color: p.color, icon_kind: p.icon_kind, icon_value: p.icon_value, parent_slug: p.parent_slug,
    owner, owner_on: !!p.owner_on, tech_lead: tech,
    pending_events: get<{ n: number }>('select count(*) n from events where project_slug = ? and handled_at is null', s)!.n,
    owner_state: !owner ? 'none' : ownerBusy ? 'working' : (waiting || p.one_on_one) ? 'waiting' : p.owner_on ? 'watching' : 'off',
    focus: focusOf(get<{ text: string }>('select text from directions where project_slug = ? order by id desc limit 1', s)?.text ?? null),
    milestone: ms && msCount ? { title: ms.title, target: ms.target, total: msCount.n, done: msCount.done ?? 0 } : null,
    rhythm: { days, delivered_7d: days.slice(7).reduce((a, b) => a + b, 0), validated_7d: op('história: accepted'), returned_7d: op('história: adjusting') },
    metrics, alerts, returned, to_validate: toValidate, decisions: waiting, active_runs: active,
    stories_open: get<{ n: number }>(`select count(*) n from tasks t where t.project_slug = ? and t."column" <> 'done' and exists (select 1 from tasks c where c.parent_id = t.id)`, s)!.n,
    one_on_one: p.one_on_one ? { why: p.one_on_one, at: p.one_on_one_at } : null,
    guide_open: get<{ id: number }>(`select id from guides where project_slug = ? and kind = 'dono' and status = 'open' order by id desc limit 1`, s)?.id ?? null,
    diary: diary?.result ? { text: firstLine(diary.result), at: diary.at } : null,
  };
}

export function cockpit(): CockpitDto {
  const rows = all<Parameters<typeof product>[0] & { status: string; position: number }>(
    `select slug, name, color, icon_kind, icon_value, parent_slug, todo_agent_id, owner_agent_id, owner_on, one_on_one, one_on_one_at, status, position
     from projects where status in ('active','maintenance') order by position, name`);
  const top = rows.filter(r => !r.parent_slug);
  const alive = (r: (typeof rows)[number]) => !!r.todo_agent_id || !!r.owner_agent_id || !!get(`select 1 from tasks where project_slug = ? and "column" <> 'done' limit 1`, r.slug)
    || !!get('select 1 from metrics where project_slug = ? limit 1', r.slug);
  return {
    companies: top.map(c => {
      const kids = rows.filter(r => r.parent_slug === c.slug);
      // a empresa também é produto quando tem vida própria (dono, trabalho ou números) ou não tem frentes
      const products = [...(!kids.length || alive(c) ? [c] : []), ...kids].map(product);
      return { slug: c.slug, name: c.name, color: c.color, icon_kind: c.icon_kind, icon_value: c.icon_value, products };
    }).filter(c => c.products.length),
  };
}
