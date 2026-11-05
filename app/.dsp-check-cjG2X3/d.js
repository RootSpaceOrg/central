"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all2) => {
  for (var name in all2)
    __defProp(target, name, { get: all2[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/dispatch.ts
var dispatch_exports = {};
__export(dispatch_exports, {
  TRIAGE_HEAD: () => TRIAGE_HEAD,
  dispatchSkip: () => dispatchSkip,
  dispatchTodo: () => dispatchTodo,
  dispatchTriage: () => dispatchTriage,
  triagePrompt: () => triagePrompt,
  withinHours: () => withinHours
});
module.exports = __toCommonJS(dispatch_exports);
var import_db = require("C:\\Users\\Gustavo\\Development\\Central\\app\\.dsp-check-cjG2X3\\db.js");

// electron/governor.ts
var PRIORITY_OF = { high: 0, normal: 1, low: 2 };
var SESSION_START = [90, 80, 60];
var WEEK_START = [95, 90, 80];
var canStart = (p, u) => (u.session ?? 0) < SESSION_START[p] && (u.week ?? 0) < WEEK_START[p];

// electron/dispatch.ts
var RETRY_AFTER_H = 12;
function withinHours(spec, now) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec.trim());
  if (!m) return true;
  const [from, to, h] = [Number(m[1]), Number(m[2]), now.getHours()];
  return from <= to ? h >= from && h < to : h >= from || h < to;
}
var lastSkip = "";
function stuck(taskId, slug, why) {
  lastSkip = `tarefa #${taskId}: ${why}`;
  if ((0, import_db.get)(`select 1 from proposals where task_id = ? and status = 'proposed'`, taskId)) return;
  const title = (0, import_db.get)("select title from tasks where id = ?", taskId)?.title ?? `#${taskId}`;
  (0, import_db.run)(
    `insert into proposals (project_slug, title, body, next_action, tier, source, source_ref, task_id) values (?,?,?,?,?,?,?,?)`,
    slug,
    `N\xE3o consegui come\xE7ar a tarefa #${taskId}`,
    `"${title}" est\xE1 em A fazer, mas n\xE3o come\xE7ou: ${why}`,
    "Ajuste a tarefa (reposit\xF3rio, agente) e aprove para tentar de novo.",
    1,
    "dispatch",
    `dispatch-${taskId}-${Date.now()}`,
    taskId
  );
}
var dispatchSkip = () => lastSkip;
async function dispatchTodo(deps) {
  const owners = (0, import_db.all)(
    `select p.slug, p.todo_agent_id agent, p.todo_parallel parallel, p.todo_hours hours, a.permission, a.priority
     from projects p join agents a on a.id = p.todo_agent_id where p.status <> 'dead'
`
  );
  const stages = (0, import_db.all)(
    `select c.board_id board, bd.name bname, c.key, c.label, c.agent_id agent, c.parallel, c.hours, c.instruction, a.permission, a.priority,
       coalesce(n.label, (select x.label from board_cols x where x.board_id = c.board_id and x.position > c.position order by x.position limit 1)) next
     from board_cols c join boards bd on bd.id = c.board_id join agents a on a.id = c.agent_id
     left join board_cols n on n.board_id = c.board_id and n.key = c.next_key`
  );
  if (!owners.length && !stages.length) return 0;
  const used = await deps.quota();
  const allowed = (p) => canStart(PRIORITY_OF[p] ?? 1, { session: used, week: null, sessionReset: null, weekReset: null });
  lastSkip = used !== null && ![...owners, ...stages].some((x) => allowed(x.priority)) ? `cota da sess\xE3o em ${used}%` : "";
  if (lastSkip) return 0;
  const now = deps.now?.() ?? /* @__PURE__ */ new Date();
  let started = 0;
  for (const o of owners) {
    if (!withinHours(o.hours, now) || !allowed(o.priority)) continue;
    const busy = (0, import_db.get)(`select count(*) n from runs where project_slug = ? and agent_id = ? and status in ('queued','preparing','running')`, o.slug, o.agent).n;
    const slots = Math.max(0, (o.parallel || 1) - busy);
    if (!slots) continue;
    const since = new Date(now.getTime() - RETRY_AFTER_H * 36e5).toISOString();
    const tasks = (0, import_db.all)(
      `select t.id, t.title, t.body, t.repo_path from tasks t
       where t.project_slug = ? and t."column" = 'todo'
         and not exists (select 1 from runs r where r.task_id = t.id and (r.status in ('queued','preparing','running') or (r.status = 'failed' and r.finished_at > ?)))
         and not exists (select 1 from json_each(coalesce(t.depends_on, '[]')) d join tasks p on p.id = d.value where p."column" not in ('review','dev','done'))
         and not exists (select 1 from proposals p where p.task_id = t.id and p.status = 'proposed')
       order by t.priority, t.position, t.id limit ?`,
      o.slug,
      since,
      slots
    );
    for (const t of tasks) {
      try {
        deps.start({ project_slug: o.slug, agent_id: o.agent, repo_path: t.repo_path, prompt: `${t.title}${t.body ? `

${t.body}` : ""}`, permission: o.permission, task_id: t.id });
        started++;
      } catch (e) {
        stuck(t.id, o.slug, e.message);
      }
    }
  }
  for (const s of stages) {
    if (!withinHours(s.hours, now) || !allowed(s.priority)) continue;
    const busy = (0, import_db.get)(`select count(*) n from runs where board_id = ? and stage = ? and status in ('queued','preparing','running')`, s.board, s.key).n;
    const slots = Math.max(0, (s.parallel || 1) - busy);
    if (!slots) continue;
    const since = new Date(now.getTime() - RETRY_AFTER_H * 36e5).toISOString();
    const tasks = (0, import_db.all)(
      `select t.id, t.title, t.body, t.repo_path, t.project_slug from task_boards x join tasks t on t.id = x.task_id
       where x.board_id = ? and x.stage = ? and t."column" <> 'done'
         and not exists (select 1 from runs r where r.task_id = t.id and (r.status in ('queued','preparing','running') or (r.board_id = ? and r.stage = ? and r.status = 'failed' and r.finished_at > ?) or r.waiting is not null))
         and not exists (select 1 from proposals p where p.task_id = t.id and p.status = 'proposed')
         and not exists (select 1 from json_each(coalesce(t.depends_on, '[]')) d join tasks p on p.id = d.value where p."column" not in ('review','dev','done'))
       order by t.priority, x.position, t.id limit ?`,
      s.board,
      s.key,
      s.board,
      s.key,
      since,
      slots
    );
    for (const t of tasks) {
      const head = `Etapa "${s.label}" do quadro ${s.bname}.${s.instruction ? `
${s.instruction}` : ""}
Ao terminar bem, a Central leva a tarefa para ${s.next ? `"${s.next}"` : "o fim do quadro"}; n\xE3o mova voc\xEA mesmo.`;
      try {
        deps.start({ project_slug: t.project_slug, agent_id: s.agent, repo_path: t.repo_path, prompt: `${head}

${t.title}${t.body ? `

${t.body}` : ""}`, permission: s.permission, task_id: t.id, stage: s.key, board_id: s.board });
        started++;
      } catch (e) {
        stuck(t.id, t.project_slug, e.message);
      }
    }
  }
  return started;
}
var TRIAGE_HEAD = "Triagem autom\xE1tica";
var TRIAGE_BATCH = 5;
async function dispatchTriage(deps) {
  const mode = deps.setting("triage:mode") ?? "no_project";
  if (mode === "off") return 0;
  const agent = Number(deps.setting("triage:agent")) || (0, import_db.get)("select id from agents where builtin = 1")?.id;
  const priority = agent ? (0, import_db.get)("select priority p from agents where id = ?", agent)?.p : null;
  if (!agent || !priority) return 0;
  if ((0, import_db.get)(`select 1 from runs where prompt like ? and status in ('queued','preparing','running')`, `${TRIAGE_HEAD}%`)) return 0;
  const ideas = (0, import_db.all)(
    `select id, title, body, project_slug from ideas where status = 'new' and triaged_at is null and author = 'gustavo'
       ${mode === "no_project" ? "and project_slug is null" : ""} order by id limit ?`,
    TRIAGE_BATCH
  );
  if (!ideas.length) return 0;
  const used = await deps.quota();
  if (!canStart(PRIORITY_OF[priority] ?? 1, { session: used, week: null, sessionReset: null, weekReset: null })) return 0;
  const at = (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
  for (const i of ideas) (0, import_db.run)("update ideas set triaged_at = ? where id = ?", at, i.id);
  deps.start({ agent_id: agent, prompt: triagePrompt(ideas) });
  return ideas.length;
}
var triagePrompt = (ideas) => `${TRIAGE_HEAD}: ${ideas.length === 1 ? `ideia #${ideas[0].id}` : `${ideas.length} ideias`}

O Gustavo anotou ${ideas.length === 1 ? "esta ideia" : "estas ideias"} na triagem. Leia e deixe cada uma pronta para ele decidir em segundos.
Para cada ideia:
1. Descubra de qual projeto \xE9 (list_projects, get_direction, roadmap, backlog, c\xF3digo se precisar) e grave com update_idea project_slug. Se n\xE3o for de nenhum, deixe sem.
2. Se o texto estiver confuso, reescreva t\xEDtulo (curto, verbo no infinitivo) e descri\xE7\xE3o em markdown com update_idea, sem perder nada do que ele escreveu.
3. Se forem v\xE1rias coisas, divida: create_idea para cada parte (mesmo projeto) e deixe a original com a principal. Ligue ao marco do roadmap (milestone_id) se servir a um.
4. Se depender de uma escolha dele, crie uma decis\xE3o (create_decision) com as op\xE7\xF5es.
5. Por fim, update_idea com triage = "<aprovar e planejar | aprovar | descartar | precisa de voc\xEA> \u2014 <motivo em uma frase>".
Nunca aprove nem descarte (status): quem decide \xE9 ele. N\xE3o crie tarefas.

${ideas.map((i) => `## Ideia #${i.id}${i.project_slug ? ` (projeto ${i.project_slug})` : " (sem projeto)"}
${i.title}${i.body ? `

${i.body}` : ""}`).join("\n\n")}`;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TRIAGE_HEAD,
  dispatchSkip,
  dispatchTodo,
  dispatchTriage,
  triagePrompt,
  withinHours
});
