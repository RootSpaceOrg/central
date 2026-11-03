"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// .dlv-check-KDaXP8/db.js
var require_db = __commonJS({
  ".dlv-check-KDaXP8/db.js"(exports2, module2) {
    var { DatabaseSync } = require("node:sqlite");
    var db = new DatabaseSync(":memory:");
    db.exec(`
  create table agents (id integer primary key, name text); insert into agents values (2, 'Marketing');
  create table projects (slug text primary key, name text); insert into projects values ('kultivai', 'KultivAi');
  create table runs (id integer primary key, project_slug text, agent_id integer, task_id integer, prompt text, status text, result text,
    pr_url text, worktree_path text, base_branch text, cost_usd real, started_at text, finished_at text);
  create table tasks (id integer primary key, title text, project_slug text, "column" text, updated_at text);
  create table milestone_events (id integer primary key, kind text, title text, detail text, author text, at text, project_slug text);
  create table ideas (id integer primary key, created_at text, status text);
  create table proposals (id integer primary key, created_at text, status text);
  create table memories (id integer primary key, created_at text, author text, status text);
  ${"create table if not exists deliveries (\n    id          integer primary key autoincrement,\n    run_id      integer not null unique references runs on delete cascade,\n    project_slug text,\n    agent_id    integer,\n    task_id     integer,\n    title       text not null,\n    what        text not null,\n    why         text,\n    how_to_test text,\n    risks       text,\n    explained   integer not null default 0,\n    outcome     text,\n    pr_url      text,\n    files       integer not null default 0,\n    additions   integer not null default 0,\n    deletions   integer not null default 0,\n    diff_stat   text,\n    status      text not null default 'pending',\n    review_note text,\n    created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),\n    reviewed_at text\n  );"}
  insert into tasks values (7, 'Exportar roadmap', 'kultivai', 'review', '2026-11-01T10:00:00Z');
  insert into runs values (1, 'kultivai', 2, 7, 'Exportar o roadmap em PDF
Detalhes', 'succeeded', 'Feito. PR aberto.', 'https://github.com/x/y/pull/3', null, null, 0.5, '2026-11-02T10:00:00Z', '2026-11-02T11:30:00Z');
  insert into runs values (2, 'kultivai', null, null, '[gestor:planejar] Voc\xEA \xE9 o gestor', 'succeeded', 'Backlog organizado.', null, null, null, 0.1, '2026-11-02T12:00:00Z', '2026-11-02T12:30:00Z');
  insert into runs values (3, 'kultivai', 2, null, 'Tentar algo', 'killed', null, null, null, null, null, '2026-11-02T12:00:00Z', '2026-11-02T12:01:00Z');
  insert into milestone_events values (1, 'done', 'App abre r\xE1pido', 'Agora \u2192 Feito', 'agente', '2026-11-02T13:00:00Z', 'kultivai');
  insert into ideas values (1, '2026-11-02T09:00:00Z', 'new');
  insert into proposals values (1, '2026-11-02T09:00:00Z', 'proposed');
  insert into memories values (1, '2026-11-02T09:00:00Z', 'agente', 'active');
`);
    module2.exports = {
      all: (s, ...a) => db.prepare(s).all(...a),
      get: (s, ...a) => db.prepare(s).get(...a),
      run: (s, ...a) => db.prepare(s).run(...a),
      now: () => "2026-11-02T14:00:00Z"
    };
  }
});

// electron/deliveries.ts
var deliveries_exports = {};
__export(deliveries_exports, {
  closeDelivery: () => closeDelivery,
  digest: () => digest,
  listDeliveries: () => listDeliveries,
  reopenDelivery: () => reopenDelivery,
  reportDelivery: () => reportDelivery,
  reviewDelivery: () => reviewDelivery
});
module.exports = __toCommonJS(deliveries_exports);
var import_node_child_process = require("node:child_process");
var import_node_util = require("node:util");
var import_db = __toESM(require_db());
var execFileP = (0, import_node_util.promisify)(import_node_child_process.execFile);
var SELECT = `select d.*, a.name agent_name, p.name project_name from deliveries d
  left join agents a on a.id = d.agent_id left join projects p on p.slug = d.project_slug`;
var fromRow = (r) => ({ ...r, explained: !!r.explained });
var listDeliveries = (since, status) => (0, import_db.all)(`${SELECT} where (? is null or d.created_at > ?) and (? is null or d.status = ?) order by d.id desc limit 200`, since, since, status, status).map(fromRow);
function reportDelivery(runId, i) {
  const r = (0, import_db.get)("select project_slug, agent_id, task_id from runs where id = ?", runId);
  if (!r) throw new Error("Execu\xE7\xE3o n\xE3o encontrada.");
  const cur = (0, import_db.get)("select id from deliveries where run_id = ?", runId);
  const fields = [i.title.trim().slice(0, 160), i.what.trim().slice(0, 2e3), i.why?.trim() || null, i.how_to_test?.trim() || null, i.risks?.trim() || null];
  if (cur) (0, import_db.run)("update deliveries set title = ?, what = ?, why = ?, how_to_test = ?, risks = ?, explained = 1 where id = ?", ...fields, cur.id);
  else (0, import_db.run)(`insert into deliveries (run_id, project_slug, agent_id, task_id, title, what, why, how_to_test, risks, explained, status)
    values (?,?,?,?,?,?,?,?,?,1,'pending')`, runId, r.project_slug, r.agent_id, r.task_id, ...fields);
}
async function closeDelivery(runId) {
  const r = (0, import_db.get)(
    "select prompt, status, result, pr_url, worktree_path, base_branch, project_slug, agent_id, task_id from runs where id = ?",
    runId
  );
  if (!r || r.status === "killed") return;
  if (!(0, import_db.get)("select 1 from deliveries where run_id = ?", runId)) {
    const title = r.prompt.includes("[gestor:planejar]") ? "Gestor organizou o backlog" : r.prompt.split("\n")[0].slice(0, 160);
    (0, import_db.run)(
      `insert into deliveries (run_id, project_slug, agent_id, task_id, title, what, explained, status) values (?,?,?,?,?,?,0,'pending')`,
      runId,
      r.project_slug,
      r.agent_id,
      r.task_id,
      title,
      (r.result ?? "Terminou sem resultado.").slice(0, 2e3)
    );
  }
  let files = 0, additions = 0, deletions = 0, stat = null;
  if (r.worktree_path && r.base_branch) {
    try {
      const base = (await execFileP("git", ["-C", r.worktree_path, "merge-base", "HEAD", r.base_branch], { windowsHide: true })).stdout.trim();
      const short = (await execFileP("git", ["-C", r.worktree_path, "diff", "--shortstat", base, "HEAD"], { windowsHide: true })).stdout;
      files = Number(/(\d+) files? changed/.exec(short)?.[1] ?? 0);
      additions = Number(/(\d+) insertions?/.exec(short)?.[1] ?? 0);
      deletions = Number(/(\d+) deletions?/.exec(short)?.[1] ?? 0);
      stat = (await execFileP("git", ["-C", r.worktree_path, "diff", "--stat=100", base, "HEAD"], { windowsHide: true })).stdout.trim().slice(-3e3) || null;
    } catch {
    }
  }
  const code = files > 0 || !!r.pr_url;
  const waiting = !!(0, import_db.get)("select waiting w from runs where id = ?", runId)?.w;
  (0, import_db.run)(
    `update deliveries set outcome = ?, pr_url = ?, files = ?, additions = ?, deletions = ?, diff_stat = ?,
       status = case when status = 'pending' then ? else status end where run_id = ?`,
    r.status,
    r.pr_url,
    files,
    additions,
    deletions,
    stat,
    waiting ? "paused" : code ? "review" : "info",
    runId
  );
}
async function reopenDelivery(runId) {
  if (!(0, import_db.run)(`update deliveries set status = 'pending' where run_id = ? and status in ('adjusting', 'paused')`, runId).changes) return;
  await closeDelivery(runId);
  const t = (0, import_db.get)("select d.task_id, r.status from deliveries d join runs r on r.id = d.run_id where d.run_id = ?", runId);
  if (t?.task_id && !(0, import_db.get)("select waiting w from runs where id = ?", runId)?.w) {
    (0, import_db.run)(`update tasks set "column" = ?, updated_at = ? where id = ? and "column" = 'doing'`, t.status === "failed" ? "todo" : "review", (0, import_db.now)(), t.task_id);
  }
}
function reviewDelivery(id, action, note) {
  const d = (0, import_db.get)("select task_id from deliveries where id = ?", id);
  if (!d) throw new Error("Entrega n\xE3o encontrada.");
  (0, import_db.run)("update deliveries set status = ?, review_note = ?, reviewed_at = ? where id = ?", action, note?.trim() || null, (0, import_db.now)(), id);
  if (action === "accepted" && d.task_id) (0, import_db.run)(`update tasks set "column" = 'done', updated_at = ? where id = ? and "column" <> 'done'`, (0, import_db.now)(), d.task_id);
}
function digest(since) {
  const n = (sql, ...a) => (0, import_db.get)(sql, ...a)?.n ?? 0;
  const runs = (0, import_db.get)(`select count(*) n,
      sum((julianday(finished_at) - julianday(started_at)) * 1440) minutes, sum(cost_usd) cost
    from runs where finished_at > ? and status <> 'killed'`, since);
  return {
    since,
    deliveries: listDeliveries(since, null),
    tasks_done: (0, import_db.all)(`select id, title, project_slug from tasks where "column" = 'done' and updated_at > ? order by updated_at desc limit 50`, since),
    roadmap: (0, import_db.all)(`select e.kind, e.title, e.detail, e.author, e.at, e.project_slug from milestone_events e where e.at > ? order by e.id desc limit 50`, since),
    ideas: n(`select count(*) n from ideas where created_at > ? and status = 'new'`, since),
    decisions: n(`select count(*) n from proposals where created_at > ? and status = 'proposed'`, since),
    memories: n(`select count(*) n from memories where created_at > ? and author <> 'gustavo' and status = 'active'`, since),
    runs: runs.n,
    minutes: Math.round(runs.minutes ?? 0),
    cost_usd: Math.round((runs.cost ?? 0) * 100) / 100
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  closeDelivery,
  digest,
  listDeliveries,
  reopenDelivery,
  reportDelivery,
  reviewDelivery
});
