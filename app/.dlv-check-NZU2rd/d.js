"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all3) => {
  for (var name in all3)
    __defProp(target, name, { get: all3[name], enumerable: true });
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

// electron/deliveries.ts
var deliveries_exports = {};
__export(deliveries_exports, {
  closeDelivery: () => closeDelivery,
  digest: () => digest,
  listDeliveries: () => listDeliveries,
  reopenDelivery: () => reopenDelivery,
  reportDelivery: () => reportDelivery,
  reviewBoard: () => reviewBoard,
  reviewDelivery: () => reviewDelivery
});
module.exports = __toCommonJS(deliveries_exports);

// electron/leftovers.ts
var import_node_child_process2 = require("node:child_process");
var import_db = require("C:\\Users\\Gustavo\\Development\\Central\\app\\.dlv-check-NZU2rd\\db.js");

// electron/proc.ts
var import_node_child_process = require("node:child_process");
var IS_WIN = process.platform === "win32";
var IS_MAC = process.platform === "darwin";
function killTree(pid, sync = false) {
  if (!pid) return;
  if (IS_WIN) {
    if (sync) {
      try {
        (0, import_node_child_process.execFileSync)("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } catch {
      }
    } else (0, import_node_child_process.execFile)("taskkill", ["/pid", String(pid), "/T", "/F"], () => {
    });
    return;
  }
  const sig = sync ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
    }
  }
}

// electron/leftovers.ts
var IS_WIN2 = process.platform === "win32";
var SERVER_TTL_MS = 2 * 36e5;
var watched = /* @__PURE__ */ new Map();
var timer = null;
function snapshot() {
  return new Promise((resolve) => {
    const done = (out) => resolve(out.split(/\r?\n/).map((l) => {
      const [pid, ppid, start, ...cmd] = l.split("|");
      return { pid: Number(pid), ppid: Number(ppid), start: start ?? "", cmd: cmd.join("|") };
    }).filter((p) => p.pid > 0));
    if (IS_WIN2) {
      (0, import_node_child_process2.execFile)(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.CreationDate.ToFileTimeUtc())|$($_.CommandLine)" }'
        ],
        { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
        (_e, out) => done(String(out ?? ""))
      );
    } else {
      (0, import_node_child_process2.execFile)("ps", ["-A", "-o", "pid=,ppid=,lstart=,command="], { maxBuffer: 32 * 1024 * 1024 }, (_e, out) => done(String(out ?? "").split("\n").map((l) => {
        const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/);
        return m ? `${m[1]}|${m[2]}|${m[3]}|${m[4]}` : "";
      }).join("\n")));
    }
  });
}
function deliveryReviewed(runId) {
  (0, import_db.run)("update run_procs set kill_after = ? where run_id = ?", (/* @__PURE__ */ new Date()).toISOString(), runId);
  reap().catch(() => {
  });
}
async function reap() {
  const due = (0, import_db.all)(`select id, pid, start from run_procs where kill_after is not null and kill_after <= ?`, (/* @__PURE__ */ new Date()).toISOString());
  if (!due.length) {
    if (!watched.size && timer && !(0, import_db.all)("select 1 from run_procs limit 1").length) {
      clearInterval(timer);
      timer = null;
    }
    return 0;
  }
  const alive = new Map((await snapshot()).map((p) => [p.pid, p.start]));
  let n = 0;
  for (const d of due) {
    if (alive.get(d.pid) === d.start) {
      killTree(d.pid);
      n++;
    }
    (0, import_db.run)("delete from run_procs where id = ?", d.id);
  }
  return n;
}

// electron/deliveries.ts
var import_node_child_process3 = require("node:child_process");
var import_node_util = require("node:util");
var import_db2 = require("C:\\Users\\Gustavo\\Development\\Central\\app\\.dlv-check-NZU2rd\\db.js");
var execFileP = (0, import_node_util.promisify)(import_node_child_process3.execFile);
var SELECT = `select d.*, a.name agent_name, p.name project_name from deliveries d
  left join agents a on a.id = d.agent_id left join projects p on p.slug = d.project_slug`;
var fromRow = (r) => ({ ...r, explained: !!r.explained });
var listDeliveries = (since, status) => (0, import_db2.all)(`${SELECT} where (? is null or d.created_at > ?) and (? is null or d.status = ?) order by d.id desc limit 200`, since, since, status, status).map(fromRow);
var reviewBoard = () => (0, import_db2.all)(`${SELECT} where d.status = 'review'
     or d.id in (select max(x.id) from deliveries x join tasks t on t.id = x.task_id where t."column" = 'review' and x.status <> 'discarded' group by x.task_id)
     order by d.id desc limit 300`).map(fromRow);
function reportDelivery(runId, i) {
  const r = (0, import_db2.get)("select project_slug, agent_id, task_id from runs where id = ?", runId);
  if (!r) throw new Error("Execu\xE7\xE3o n\xE3o encontrada.");
  const cur = (0, import_db2.get)("select id from deliveries where run_id = ?", runId);
  const fields = [i.title.trim().slice(0, 160), i.what.trim().slice(0, 2e3), i.why?.trim() || null, i.how_to_test?.trim() || null, i.risks?.trim() || null];
  if (cur) (0, import_db2.run)("update deliveries set title = ?, what = ?, why = ?, how_to_test = ?, risks = ?, explained = 1 where id = ?", ...fields, cur.id);
  else (0, import_db2.run)(`insert into deliveries (run_id, project_slug, agent_id, task_id, title, what, why, how_to_test, risks, explained, status)
    values (?,?,?,?,?,?,?,?,?,1,'pending')`, runId, r.project_slug, r.agent_id, r.task_id, ...fields);
}
async function closeDelivery(runId) {
  const r = (0, import_db2.get)(
    "select prompt, status, result, pr_url, worktree_path, base_branch, project_slug, agent_id, task_id from runs where id = ?",
    runId
  );
  if (!r || r.status === "killed") return;
  if (r.prompt.startsWith("[respons\xE1vel:escolher]") || r.prompt.startsWith("[escuta]")) return;
  if (!(0, import_db2.get)("select 1 from deliveries where run_id = ?", runId)) {
    const title = r.prompt.includes("[gestor:planejar]") ? "Gestor organizou o backlog" : r.prompt.split("\n")[0].slice(0, 160);
    (0, import_db2.run)(
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
  const waiting = !!(0, import_db2.get)("select waiting w from runs where id = ?", runId)?.w;
  (0, import_db2.run)(
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
  if (!(0, import_db2.run)(`update deliveries set status = 'pending' where run_id = ? and status in ('adjusting', 'paused')`, runId).changes) return;
  await closeDelivery(runId);
  const t = (0, import_db2.get)("select d.task_id, r.status from deliveries d join runs r on r.id = d.run_id where d.run_id = ?", runId);
  if (t?.task_id && !(0, import_db2.get)("select waiting w from runs where id = ?", runId)?.w) {
    (0, import_db2.run)(`update tasks set "column" = ?, updated_at = ? where id = ? and "column" = 'doing'`, t.status === "failed" ? "todo" : "review", (0, import_db2.now)(), t.task_id);
  }
}
function reviewDelivery(id, action, note) {
  const d = (0, import_db2.get)("select task_id from deliveries where id = ?", id);
  if (!d) throw new Error("Entrega n\xE3o encontrada.");
  (0, import_db2.run)("update deliveries set status = ?, review_note = ?, reviewed_at = ? where id = ?", action, note?.trim() || null, (0, import_db2.now)(), id);
  if (action !== "adjusting") {
    const r = (0, import_db2.get)("select run_id from deliveries where id = ?", id);
    if (r) deliveryReviewed(r.run_id);
  }
  if (action === "accepted" && d.task_id) {
    const prodWithPr = (0, import_db2.get)("select 1 from tasks t join projects p on p.slug = t.project_slug where t.id = ? and p.done_when = ? and t.pr_url is not null", d.task_id, "prod");
    if (!prodWithPr) (0, import_db2.run)(`update tasks set "column" = 'done', updated_at = ? where id = ? and "column" <> 'done'`, (0, import_db2.now)(), d.task_id);
  }
}
function digest(since) {
  const n = (sql, ...a) => (0, import_db2.get)(sql, ...a)?.n ?? 0;
  const runs = (0, import_db2.get)(`select count(*) n,
      sum((julianday(finished_at) - julianday(started_at)) * 1440) minutes, sum(cost_usd) cost
    from runs where finished_at > ? and status <> 'killed'`, since);
  return {
    since,
    deliveries: listDeliveries(since, null),
    tasks_done: (0, import_db2.all)(`select id, title, project_slug from tasks where "column" = 'done' and updated_at > ? order by updated_at desc limit 50`, since),
    roadmap: (0, import_db2.all)(`select e.kind, e.title, e.detail, e.author, e.at, e.project_slug from milestone_events e where e.at > ? order by e.id desc limit 50`, since),
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
  reviewBoard,
  reviewDelivery
});
