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
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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

// node_modules/electron/index.js
var require_electron = __commonJS({
  "node_modules/electron/index.js"(exports2, module2) {
    var { spawnSync } = require("child_process");
    var fs = require("fs");
    var path = require("path");
    var pathFile = path.join(__dirname, "path.txt");
    function downloadElectron() {
      console.log("Downloading Electron binary...");
      const result = spawnSync(process.execPath, [path.join(__dirname, "install.js")], {
        stdio: "inherit"
      });
      if (result.status !== 0) {
        throw new Error(
          'Electron failed to install correctly. Please delete `node_modules/electron` and run "npx install-electron --no" manually.'
        );
      }
    }
    function getElectronPath() {
      let executablePath;
      if (fs.existsSync(pathFile)) {
        executablePath = fs.readFileSync(pathFile, "utf-8");
      }
      if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
        return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || "electron");
      }
      if (executablePath) {
        const fullPath = path.join(__dirname, "dist", executablePath);
        if (!fs.existsSync(fullPath)) {
          downloadElectron();
        }
        return fullPath;
      } else {
        try {
          downloadElectron();
        } catch {
          throw new Error(
            'Electron failed to install correctly. Please delete `node_modules/electron` and run "npx install-electron --no" manually.'
          );
        }
        executablePath = fs.readFileSync(pathFile, "utf-8");
        return path.join(__dirname, "dist", executablePath);
      }
    }
    module2.exports = getElectronPath();
  }
});

// electron/activity.ts
var activity_exports = {};
__export(activity_exports, {
  ActivityTracker: () => ActivityTracker,
  listActivity: () => listActivity,
  onActivity: () => onActivity,
  phaseOf: () => phaseOf,
  setStatus: () => setStatus,
  track: () => track,
  untrack: () => untrack
});
module.exports = __toCommonJS(activity_exports);

// electron/db.ts
var import_electron = __toESM(require_electron());
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var import_node_sqlite = require("node:sqlite");
var dataDir = process.argv.find((a) => a.startsWith("--data="))?.slice(7);
if (dataDir) import_electron.app.setPath("userData", dataDir);
var DEV_ROOT = (0, import_node_path.join)((0, import_node_os.homedir)(), "Development");
var DB_PATH = (0, import_node_path.join)(import_electron.app.getPath("userData"), "central.db");
(0, import_node_fs.mkdirSync)(import_electron.app.getPath("userData"), { recursive: true });
var db = new import_node_sqlite.DatabaseSync(DB_PATH);
db.exec(`
  pragma journal_mode = wal;
  pragma foreign_keys = on;

  create table if not exists projects (
    slug        text primary key,
    name        text not null,
    folder      text not null unique,
    status      text not null default 'active' check (status in ('active','maintenance','frozen','dead')),
    color       text not null,
    description text,
    created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists repos (
    path           text primary key,
    project_slug   text not null references projects on delete cascade,
    name           text not null,
    remote         text,
    default_branch text,
    branch         text,
    dirty          integer not null default 0,
    ahead          integer not null default 0,
    behind         integer not null default 0,
    scanned_at     text not null
  );

  create table if not exists commits (
    repo_path    text not null references repos(path) on delete cascade,
    sha          text not null,
    committed_at text not null,  -- ISO UTC
    author       text not null,
    subject      text not null,
    primary key (repo_path, sha)
  );
  create index if not exists commits_by_date on commits (committed_at desc);

  create table if not exists proposals (
    id                integer primary key autoincrement,
    project_slug      text references projects on delete set null,
    title             text not null,
    body              text,
    tier              integer check (tier in (0,1,2)),
    est_attention_min integer,
    next_action       text,
    status            text not null default 'proposed'
                      check (status in ('proposed','approved','rejected','deferred','running','done','killed')),
    source            text not null,
    source_ref        text not null,
    created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    unique (source, source_ref)
  );

  create table if not exists decisions (
    id          integer primary key autoincrement,
    proposal_id integer not null references proposals on delete cascade,
    verdict     text not null,
    reason      text,
    decided_at  text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists runs (
    id            integer primary key autoincrement,
    project_slug  text references projects on delete set null,
    proposal_id   integer references proposals on delete set null,
    repo_path     text not null,
    worktree_path text,
    branch        text,
    base_branch   text,
    prompt        text not null,
    status        text not null default 'queued'
                  check (status in ('queued','preparing','running','succeeded','failed','killed')),
    permission    text not null check (permission in ('edits','full')),
    budget_usd    real not null,
    cost_usd      real,
    pr_url        text,
    result        text,
    created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    started_at    text,
    finished_at   text
  );

  create table if not exists run_events (
    id     integer primary key autoincrement,
    run_id integer not null references runs on delete cascade,
    at     text not null,
    kind   text not null,
    text   text not null
  );
  create index if not exists run_events_by_run on run_events (run_id, id);

  create table if not exists ideas (
    id           integer primary key autoincrement,
    project_slug text references projects on delete set null,
    title        text not null,
    body         text,
    status       text not null default 'new' check (status in ('new','approved','doing','done','archived')),
    source       text not null,
    source_ref   text not null,
    task_id      integer,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    unique (source, source_ref)
  );

  create table if not exists tasks (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    title        text not null,
    body         text,
    "column"     text not null default 'backlog' check ("column" in ('backlog','todo','doing','review','done')),
    priority     integer not null default 2 check (priority between 0 and 3),
    position     real not null default 0,
    pr_url       text,
    proposal_id  integer references proposals on delete set null,
    idea_id      integer references ideas on delete set null,
    source       text,
    source_ref   text,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    unique (source, source_ref)
  );

  create table if not exists turns (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    until        text not null,
    budget_usd   real not null,
    status       text not null default 'running' check (status in ('running','done','stopped')),
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    finished_at  text
  );

  create table if not exists routines (
    id             integer primary key autoincrement,
    name           text not null,
    project_slug   text references projects on delete set null,
    repo_path      text,
    prompt         text not null,
    permission     text not null default 'edits',
    size           text not null default 'small',
    schedule_kind  text not null default 'daily',
    days           text not null default '1,2,3,4,5',
    time           text not null default '08:00',
    interval_hours integer not null default 24,
    max_session    integer not null default 80,
    enabled        integer not null default 1,
    next_run_at    text not null,
    last_run_at    text,
    last_skipped   text,
    created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists chats (
    id         integer primary key autoincrement,
    title      text not null,
    session_id text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists chat_messages (
    id      integer primary key autoincrement,
    chat_id integer not null references chats on delete cascade,
    role    text not null,
    text    text not null,
    at      text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists agents (
    id           integer primary key autoincrement,
    slug         text not null unique,
    name         text not null,
    description  text,
    color        text not null default '#7FA2FF',
    icon_kind    text not null default 'letter',
    icon_value   text,
    project_slug text references projects on delete set null,
    instructions text not null default '',
    tools        text not null default '',
    permission   text not null default 'edits',
    model        text not null default '',
    builtin      integer not null default 0,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  create table if not exists sessions (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    kind         text not null,
    title        text not null,
    chat_id      integer references chats on delete set null,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  -- rumo do projeto: para onde vamos (objetivo, foco do momento, o que n\xE3o fazer). Cada vers\xE3o fica guardada.
  create table if not exists directions (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    text         text not null,
    author       text not null,
    note         text,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  create index if not exists directions_by_project on directions(project_slug, id);

  -- roadmap do projeto: marcos em Agora / Pr\xF3ximo / Depois (sem data obrigat\xF3ria; alvo opcional, ex.: "dez", "Q1")
  create table if not exists milestones (
    id           integer primary key autoincrement,
    project_slug text not null references projects on delete cascade,
    title        text not null,
    description  text,
    horizon      text not null default 'next' check (horizon in ('now','next','later','done')),
    target       text,
    position     integer not null default 0,
    created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    done_at      text
  );

  -- hist\xF3rico do roadmap: quem mexeu (gustavo ou agente), o qu\xEA e por qu\xEA
  create table if not exists milestone_events (
    id           integer primary key autoincrement,
    milestone_id integer,
    project_slug text not null references projects on delete cascade,
    kind         text not null,
    title        text not null,
    detail       text,
    author       text not null default 'gustavo',
    at           text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  -- mem\xF3ria do projeto: fatos dur\xE1veis (decis\xE3o, conven\xE7\xE3o, armadilha\u2026) com proveni\xEAncia, ligados a n\xF3s do \xEDndice de c\xF3digo
  create table if not exists facts (
    id             integer primary key autoincrement,
    project_slug   text not null references projects on delete cascade,
    kind           text not null,
    text           text not null,
    source_kind    text not null,
    source_ref     text,
    author         text not null,
    pinned         integer not null default 0,
    status         text not null default 'active',
    created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    invalidated_at text,
    superseded_by  integer
  );
  create table if not exists fact_links (
    fact_id  integer not null references facts on delete cascade,
    node_key text not null,
    primary key (fact_id, node_key)
  ) without rowid;

  -- o que cada execu\xE7\xE3o/conversa tocou (arquivos lidos, editados, consultados no \xEDndice)
  create table if not exists touches (
    id           integer primary key autoincrement,
    project_slug text,
    run_id       integer,
    chat_id      integer,
    node_key     text not null,
    how          text not null,
    at           text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  create index if not exists touches_by_run on touches(run_id);
  create index if not exists touches_by_project on touches(project_slug, at);

  create table if not exists settings (
    key   text primary key,
    value text not null
  );
`);
for (const [table, column, type] of [
  ["runs", "task_id", "integer"],
  ["runs", "turn_id", "integer"],
  ["tasks", "repo_path", "text"],
  ["projects", "icon_kind", "text not null default 'letter'"],
  ["projects", "icon_value", "text"],
  ["runs", "scope", "text not null default 'repo'"],
  ["runs", "routine_id", "integer"],
  ["runs", "usage_start", "real"],
  ["runs", "usage_end", "real"],
  ["runs", "agent_id", "integer"],
  ["runs", "session_id", "text"],
  ["routines", "agent_id", "integer"],
  ["chats", "agent_id", "integer"],
  ["chats", "cwd", "text"],
  ["chats", "project_slug", "text"],
  ["projects", "autopilot", "integer not null default 0"],
  ["ideas", "author", "text not null default 'gustavo'"],
  ["ideas", "approved_at", "text"],
  ["chats", "model", "text not null default ''"],
  ["chats", "effort", "text not null default ''"],
  ["projects", "parent_slug", "text"],
  ["tasks", "milestone_id", "integer"],
  ["ideas", "milestone_id", "integer"],
  ["projects", "position", "integer not null default 0"],
  ["agents", "room", "text not null default ''"],
  ["milestones", "author", "text not null default 'gustavo'"],
  ["milestones", "note", "text"],
  ["projects", "autopilot_brief", "text not null default ''"],
  ["projects", "autopilot_mode", "text not null default 'tasks'"]
]) {
  const cols = db.prepare(`pragma table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`alter table ${table} add column ${column} ${type}`);
}
for (const table of ["runs", "routines"]) {
  const col = db.prepare(`pragma table_info(${table})`).all().find((c) => c.name === "project_slug");
  if (!col?.notnull) continue;
  const ddl = db.prepare(`select sql from sqlite_master where type = 'table' and name = ?`).get(table).sql;
  const relaxed = ddl.replace(/project_slug(\s+)text not null references projects on delete cascade/i, "project_slug$1text references projects on delete set null").replace(/^CREATE TABLE\s+"?\w+"?/i, `CREATE TABLE ${table}_new`);
  db.exec("pragma foreign_keys = off");
  db.exec("begin");
  try {
    db.exec(relaxed);
    db.exec(`insert into ${table}_new select * from ${table}`);
    db.exec(`drop table ${table}`);
    db.exec(`alter table ${table}_new rename to ${table}`);
    db.exec("commit");
  } catch (e) {
    db.exec("rollback");
    throw e;
  } finally {
    db.exec("pragma foreign_keys = on");
  }
}
{
  const ddl = db.prepare(`select sql from sqlite_master where type = 'table' and name = 'ideas'`).get().sql;
  if (ddl.includes("'promoted'")) {
    const next = ddl.replace(/check \(status in \([^)]*\)\)/i, "check (status in ('new','approved','doing','done','archived'))").replace(/^CREATE TABLE\s+"?\w+"?/i, "CREATE TABLE ideas_new");
    db.exec("pragma foreign_keys = off");
    db.exec("begin");
    try {
      db.exec(next);
      db.exec(`insert into ideas_new select * from ideas`);
      db.exec(`update ideas_new set status = 'doing' where status = 'promoted'`);
      db.exec("drop table ideas");
      db.exec("alter table ideas_new rename to ideas");
      db.exec("commit");
    } catch (e) {
      db.exec("rollback");
      throw e;
    } finally {
      db.exec("pragma foreign_keys = on");
    }
  }
}
var get = (sql, ...params) => db.prepare(sql).get(...params);
var run = (sql, ...params) => db.prepare(sql).run(...params);
var now = () => (/* @__PURE__ */ new Date()).toISOString();
run(`update runs set status = 'failed', result = coalesce(result, 'App fechado durante a execu\xE7\xE3o.'), finished_at = ?
     where status in ('queued','preparing','running')`, now());
seed();
function seed() {
  if (get("select count(*) n from projects").n > 0) return;
  const d = (f) => (0, import_node_path.join)(DEV_ROOT, f);
  const projects = [
    [
      "kultivai",
      "KultivAi / MarketingPet",
      d("mktPlatform"),
      "active",
      "#3FBF8A",
      "Fonte de renda. SaaS multi-tenant de conte\xFAdo para redes sociais, com editor, IA, Instagram e cobran\xE7a."
    ],
    [
      "marketingpet-platform",
      "MarketingPet Platform",
      d("platform"),
      "active",
      "#FF9F68",
      "Base Laravel do MarketingPet, paralela ao mkt-platform."
    ],
    [
      "alfabetizare",
      "Alfabetizare",
      d("Alfabetizare"),
      "maintenance",
      "#E0B44C",
      "Cliente. Alfabetiza\xE7\xE3o e flu\xEAncia leitora para escolas. Vers\xE3o Lovable em produ\xE7\xE3o, Angular + AWS em migra\xE7\xE3o."
    ],
    [
      "matriztech",
      "MatrizTech",
      d("SkillHub"),
      "maintenance",
      "#7FA2FF",
      "Cursos gamificados do Fundamental ao M\xE9dio + livros da Cole\xE7\xE3o Tech."
    ],
    ["mapaedu", "MapaEdu", d("MapaEdu"), "active", "#4CC9F0", "Org Alicera-Products."],
    ["adaptclass", "AdaptClass", d("AdaptClass"), "active", "#B48CFF", "Org Alicera-Products."],
    ["central", "Central", d("Central"), "active", "#F07167", "Este app."],
    ["operacao", "Opera\xE7\xE3o", d("ops-runbook"), "maintenance", "#9AA5B8", "Runbook de suporte dos produtos RootSpace."],
    ["moldes", "Moldes", d("Templates"), "maintenance", "#8C9BB5", "Templates de infra e Lambda que originam os produtos."],
    ["fabrica", "F\xE1brica de templates", d("TemplateGenerator"), "dead", "#6B7385", null],
    ["healthmarket", "HealthMarket", d("HealthMarket"), "dead", "#6B7385", "Migrado para o mkt-platform."],
    ["kultivai-legado", "KultivAi (legado)", d("KultivAi"), "dead", "#6B7385", "Snapshot antigo; roda hoje como tenant do mkt-platform."]
  ];
  for (const p of projects) {
    run("insert into projects (slug, name, folder, status, color, description) values (?,?,?,?,?,?)", ...p);
  }
  const mem = (0, import_node_path.join)((0, import_node_os.homedir)(), ".claude", "projects", "C--Users-Gustavo-Development-mktPlatform", "memory");
  const proposals = [
    [
      "kultivai",
      "Fechar os 6 PRs de Afiliados (Fase 1)",
      "Arquitetura decidida em agosto, PRs GUS-76 a 81 parados em review desde ent\xE3o. A\xE7\xF5es manuais no Stripe ainda pendentes.",
      1,
      15,
      "Um agente revalida os 6 PRs contra a develop atual e monta um resumo \xFAnico para voc\xEA aprovar.",
      "project_afiliados_fase1.md"
    ],
    [
      "kultivai",
      "Validar em produ\xE7\xE3o a corre\xE7\xE3o do Instagram 190 e do timeout de 29s",
      "No ar desde 26/08 em 4 repos, ainda sem prova com tr\xE1fego real.",
      0,
      5,
      "Um agente l\xEA os logs dos \xFAltimos 30 dias e diz se o erro 190 e o timeout sumiram.",
      "project_instagram_190_timeout.md"
    ],
    [
      "kultivai",
      "Landing page v2: commitar e publicar em dev",
      "A /lp-v2 est\xE1 na branch feature/landing-page-v2 sem commit desde 18/09, com decis\xF5es de estilo j\xE1 tomadas.",
      1,
      10,
      "Um agente commita, abre o PR para develop e manda o link do preview.",
      "project_landing_page_v2.md"
    ],
    [
      "matriztech",
      "Validar as 360 aulas da Cole\xE7\xE3o Tech",
      "Cole\xE7\xE3o fechada em 15/08; falta a valida\xE7\xE3o aula a aula e uma provoca\xE7\xE3o de UI.",
      1,
      20,
      "Um agente gera um relat\xF3rio de inconsist\xEAncias por volume para voc\xEA revisar s\xF3 o que falhou.",
      "project_colecao_tech_360_completo.md"
    ]
  ];
  for (const [slug, title, body, tier, min, next, file] of proposals) {
    run(`insert into proposals (project_slug, title, body, tier, est_attention_min, next_action, source, source_ref)
         values (?,?,?,?,?,?,'memory',?)`, slug, title, body, tier, min, next, (0, import_node_path.join)(mem, file));
  }
}

// electron/activity.ts
var SUBAGENT = /* @__PURE__ */ new Set(["Agent", "Task"]);
var INTERNAL = /* @__PURE__ */ new Set(["ToolSearch"]);
var PLAN = /* @__PURE__ */ new Set(["TaskCreate", "TaskUpdate", "TodoWrite", "TaskList", "TaskGet"]);
function phaseOf(name, input) {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return "construindo";
  if (/^(Read|Grep|Glob|LS|WebFetch|WebSearch)$/.test(name) || /^mcp__central__(code_|memory_|get_|list_)/.test(name)) return "investigando";
  if (PLAN.has(name) || /^mcp__central__(create_task|update_task|plan_backlog|create_milestone|update_milestone|create_idea)/.test(name)) return "planejando";
  if (SUBAGENT.has(name)) return "delegando";
  if (name === "Bash") {
    const cmd = String(input?.command ?? "");
    if (/\b(git (commit|push)|gh pr (create|merge))\b/.test(cmd)) return "entregando";
    if (/\b(test|vitest|jest|pytest|tsc|lint|eslint|\.check\.mjs|npm run (check|build)|ng build|dotnet test)\b/.test(cmd)) return "testando";
    if (/\bgit (diff|log|status|show)\b/.test(cmd)) return "revisando";
    return "construindo";
  }
  return null;
}
var secs = (ms) => ms < 6e4 ? `${Math.round(ms / 1e3)}s` : `${Math.floor(ms / 6e4)}min${Math.round(ms % 6e4 / 1e3)}s`;
var ActivityTracker = class {
  /**
   * describe: rótulo amigável de uma ferramenta; onChange: avisa a tela (no máximo a cada 300 ms);
   * onSubagentDone: guarda no histórico ("Subagente X terminou em 1min20s").
   */
  constructor(describe, onChange, onSubagentDone) {
    this.describe = describe;
    this.onChange = onChange;
    this.onSubagentDone = onSubagentDone;
    onChange(this.activity);
  }
  describe;
  onChange;
  onSubagentDone;
  activity = { started_at: (/* @__PURE__ */ new Date()).toISOString(), step: null, subagents: [], plan: [], phase: null, status: null };
  timer = null;
  /** É passo de subagente? (o histórico mostra recuado) */
  isSubagentStep(msg) {
    return !!msg.parent_tool_use_id;
  }
  handle(msg) {
    const parent = msg.parent_tool_use_id ?? null;
    let changed = false;
    if (msg.type === "assistant") {
      for (const b of msg.message?.content ?? []) {
        if (b.type !== "tool_use" || INTERNAL.has(b.name)) continue;
        if (!parent) {
          const ph = phaseOf(b.name, b.input);
          if (ph && ph !== this.activity.phase) {
            this.activity.phase = ph;
            changed = true;
          }
        }
        if (PLAN.has(b.name)) {
          if (!parent && this.plan(b.name, b.input)) changed = true;
          continue;
        }
        const sub = parent ? this.activity.subagents.find((s) => s.id === parent) : null;
        if (sub) {
          sub.step = this.describe(b.name, b.input);
          sub.steps++;
          changed = true;
        } else if (!parent && SUBAGENT.has(b.name)) {
          this.activity.subagents.push({
            id: b.id,
            type: b.input?.subagent_type ?? "subagente",
            description: b.input?.description ?? "Subagente",
            started_at: (/* @__PURE__ */ new Date()).toISOString(),
            finished_at: null,
            step: null,
            steps: 0
          });
          changed = true;
        } else if (!parent) {
          this.activity.step = this.describe(b.name, b.input);
          changed = true;
        }
      }
      if (!parent && (msg.message?.content ?? []).some((b) => b.type === "text")) {
        this.activity.step = "Escrevendo a resposta";
        this.activity.phase = "escrevendo";
        changed = true;
      }
    } else if (msg.type === "user" && !parent) {
      for (const b of msg.message?.content ?? []) {
        if (b.type !== "tool_result") continue;
        const sub = this.activity.subagents.find((s) => s.id === b.tool_use_id && !s.finished_at);
        if (!sub) continue;
        sub.finished_at = (/* @__PURE__ */ new Date()).toISOString();
        sub.step = null;
        changed = true;
        const ms = Date.parse(sub.finished_at) - Date.parse(sub.started_at);
        this.onSubagentDone(`Subagente "${sub.description}" (${sub.type}) terminou em ${secs(ms)}, ${sub.steps} passo${sub.steps === 1 ? "" : "s"}`);
      }
    }
    if (changed) this.emit();
  }
  /**
   * Plano da sessão principal. TaskCreate não traz o id (vem no resultado): o Claude Code numera 1, 2, 3… na ordem.
   * TodoWrite (versões antigas) manda a lista inteira de uma vez.
   */
  plan(name, input) {
    const plan = this.activity.plan;
    if (name === "TaskCreate") {
      plan.push({ id: String(plan.length + 1), title: String(input?.subject ?? input?.description ?? "Tarefa"), active: input?.activeForm ?? null, status: "pending" });
      return true;
    }
    if (name === "TaskUpdate") {
      const item = plan.find((p) => p.id === String(input?.taskId));
      if (!item) return false;
      if (["pending", "in_progress", "completed"].includes(input?.status)) item.status = input.status;
      if (input?.status === "deleted") plan.splice(plan.indexOf(item), 1);
      if (input?.subject) item.title = String(input.subject);
      if (input?.activeForm) item.active = String(input.activeForm);
      return true;
    }
    if (name === "TodoWrite" && Array.isArray(input?.todos)) {
      this.activity.plan = input.todos.map((t, i) => ({
        id: String(i + 1),
        title: String(t.content ?? ""),
        active: t.activeForm ?? null,
        status: ["pending", "in_progress", "completed"].includes(t.status) ? t.status : "pending"
      }));
      return true;
    }
    return false;
  }
  /** O agente disse o que está fazendo (set_status). */
  declare(phase, doing, taskId) {
    const task = taskId ? get("select title from tasks where id = ?", taskId) : null;
    this.activity.status = { phase, doing: doing.trim().slice(0, 140), task_id: task ? taskId : null, task_title: task?.title ?? null, at: (/* @__PURE__ */ new Date()).toISOString() };
    this.activity.phase = phase;
    this.emit();
  }
  emit() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange(this.activity);
    }, 300);
  }
  /** Fim da sessão: para o aviso pendente. */
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
};
var live = /* @__PURE__ */ new Map();
var trackers = /* @__PURE__ */ new Map();
var notify = () => {
};
function onActivity(fn) {
  notify = fn;
}
var listActivity = () => [...live.values()];
function track(scope, ref, describe, onSubagentDone) {
  const t = new ActivityTracker(describe, (a) => {
    live.set(`${scope}:${ref}`, { ...a, scope, ref, subagents: a.subagents.map((s) => ({ ...s })), plan: a.plan.map((p) => ({ ...p })), status: a.status ? { ...a.status } : null });
    notify(scope, ref, live.get(`${scope}:${ref}`));
  }, onSubagentDone);
  trackers.set(`${scope}:${ref}`, t);
  return t;
}
function setStatus(scope, ref, phase, doing, taskId) {
  const t = trackers.get(`${scope}:${ref}`);
  if (!t) return false;
  t.declare(phase, doing, taskId);
  return true;
}
function untrack(scope, ref, t) {
  t?.stop();
  trackers.delete(`${scope}:${ref}`);
  live.delete(`${scope}:${ref}`);
  notify(scope, ref, null);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ActivityTracker,
  listActivity,
  onActivity,
  phaseOf,
  setStatus,
  track,
  untrack
});
