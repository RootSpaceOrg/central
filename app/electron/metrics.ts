/**
 * Números do produto como dado (combinados no 1:1 ou propostos pelo dono; sem deploy para um número novo) e o pedido de
 * 1:1 que o dono faz. Só depende do banco: o dono, o cockpit e o 1:1 usam.
 */
import { all, get, run } from './db';

// ---------- métricas como dado ----------

export interface MetricDef { id: number; project_slug: string; name: string; unit: string | null; how: string; every_hours: number; target: number | null; active: number; last_at: string | null }

/** cria ou atualiza a definição de um número do produto (pelo nome) */
export function defineMetric(slug: string, i: { name: string; unit?: string | null; how: string; every_hours?: number; target?: number | null; active?: boolean }): string {
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error(`Projeto ${slug} não existe.`);
  const name = i.name.trim().slice(0, 60);
  if (!name || !i.how?.trim()) throw new Error('Diga o nome e como medir (de onde vem o número).');
  const every = Math.max(1, Math.round(i.every_hours ?? 24));
  const cur = get<{ id: number }>('select id from metric_defs where project_slug = ? and name = ?', slug, name);
  if (cur) run('update metric_defs set unit = ?, how = ?, every_hours = ?, target = ?, active = ? where id = ?', i.unit ?? null, i.how.trim(), every, i.target ?? null, i.active === false ? 0 : 1, cur.id);
  else run('insert into metric_defs (project_slug, name, unit, how, every_hours, target, active) values (?,?,?,?,?,?,?)', slug, name, i.unit ?? null, i.how.trim(), every, i.target ?? null, i.active === false ? 0 : 1);
  return `${cur ? 'Atualizei' : 'Combinei'} "${name}": medir a cada ${every} h${i.target != null ? `, meta ${i.target}${i.unit ? ` ${i.unit}` : ''}` : ''}. Aparece no cockpit quando você registrar a primeira medida (report_metric).`;
}

export const listMetricDefs = (slug: string) => all<MetricDef>(
  `select d.*, (select max(at) from metrics m where m.project_slug = d.project_slug and m.name = d.name) last_at from metric_defs d where d.project_slug = ? order by d.id`, slug);

/** definições vencidas (passou o intervalo desde a última medida): viram evento para o dono medir */
export function dueMetrics(slug: string, now = Date.now()): MetricDef[] {
  return listMetricDefs(slug).filter(d => d.active && (!d.last_at || now - Date.parse(d.last_at.endsWith('Z') ? d.last_at : `${d.last_at}Z`) >= d.every_hours * 3_600_000));
}

// ---------- pedido de 1:1 ----------

/** quem avisa o Gustavo que um dono pediu 1:1 (o main liga: notificação do Windows) */
let oneOnOneOut: (slug: string, product: string, why: string) => void = () => {};
export const onOneOnOne = (fn: typeof oneOnOneOut) => { oneOnOneOut = fn; };

export function requestOneOnOne(slug: string, why: string): string {
  const p = get<{ name: string; one_on_one: string | null }>('select name, one_on_one from projects where slug = ?', slug);
  if (!p) throw new Error(`Projeto ${slug} não existe.`);
  const text = why.trim().slice(0, 300);
  run('update projects set one_on_one = ?, one_on_one_at = ? where slug = ?', text, new Date().toISOString(), slug);
  // avisa na hora (só quando o pedido é novo: repetir o mesmo não notifica de novo)
  if (p.one_on_one !== text) oneOnOneOut(slug, p.name, text);
  return 'Pedido de 1:1 aparece no cockpit do Gustavo, no seu produto.';
}

