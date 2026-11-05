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

// electron/release.ts
var release_exports = {};
__export(release_exports, {
  isBackMerge: () => isBackMerge,
  parseEntry: () => parseEntry,
  releaseStatus: () => releaseStatus,
  releaseSummary: () => releaseSummary,
  webUrl: () => webUrl
});
module.exports = __toCommonJS(release_exports);
var import_node_child_process = require("node:child_process");
var import_node_util = require("node:util");
var import_db = require("C:\\Users\\Gustavo\\Development\\Central\\app\\.dsp-check-GQNmrj\\db.js");
var execFileP = (0, import_node_util.promisify)(import_node_child_process.execFile);
var TTL = 10 * 6e4;
var cache = /* @__PURE__ */ new Map();
var git = async (cwd, args, timeout = 2e4) => (await execFileP("git", ["-C", cwd, ...args], { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 })).stdout;
var exists = (cwd, ref) => git(cwd, ["rev-parse", "--verify", "--quiet", ref]).then(() => true, () => false);
function webUrl(remote) {
  if (!remote) return null;
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}` : null;
}
var isBackMerge = (subject) => /back-?merge|^Merge (remote-tracking )?branch '(origin\/)?(main|master)'/i.test(subject);
function parseEntry(subject, body) {
  const merge = /^Merge pull request #(\d+) from \S+/.exec(subject);
  if (merge) return { pr: Number(merge[1]), title: body.split("\n").find((l) => l.trim())?.trim() || subject };
  const squash = /^(.*)\s\(#(\d+)\)$/.exec(subject);
  if (squash) return { pr: Number(squash[2]), title: squash[1] };
  return { pr: null, title: subject };
}
async function repoStatus(path, name, remote, fetch) {
  const base = { path, name, prod: null, dev: null, commits: 0, items: [], oldest_at: null, error: null, url: webUrl(remote) };
  try {
    if (fetch && remote) await git(path, ["fetch", "origin", "--quiet", "--prune"], 45e3).catch(() => {
      base.error = "n\xE3o deu para buscar o remoto (offline?); mostrando o \xFAltimo conhecido";
    });
    base.prod = await exists(path, "origin/main") ? "main" : await exists(path, "origin/master") ? "master" : null;
    base.dev = await exists(path, "origin/develop") ? "develop" : await exists(path, "origin/dev") ? "dev" : null;
    if (!base.prod || !base.dev) return base;
    const range = `origin/${base.prod}..origin/${base.dev}`;
    base.commits = Number((await git(path, ["rev-list", "--count", range])).trim());
    const raw = await git(path, ["log", range, "--first-parent", "--format=%H%x1f%ct%x1f%an%x1f%s%x1f%b%x1e"]);
    const url = base.url;
    base.items = raw.split("").map((s) => s.trim()).filter(Boolean).filter((rec) => !isBackMerge(rec.split("")[3] ?? "")).map((rec) => {
      const [sha, ct, author, subject, body = ""] = rec.split("");
      const { pr, title } = parseEntry(subject, body);
      const prUrl = pr && url ? `${url}/pull/${pr}` : null;
      const delivery = prUrl ? (0, import_db.get)("select title, task_id from deliveries where pr_url = ?", prUrl) : null;
      return { sha, at: new Date(Number(ct) * 1e3).toISOString(), author, title, pr, url: prUrl, delivery: delivery?.title ?? null, task_id: delivery?.task_id ?? null };
    });
    base.oldest_at = base.items.at(-1)?.at ?? null;
  } catch (e) {
    base.error = String(e.message ?? e).split("\n")[0].slice(0, 200);
  }
  return base;
}
async function releaseStatus(slug, refresh = false) {
  const hit = cache.get(slug);
  if (hit && !refresh && Date.now() - hit.at < TTL) return hit.data;
  const repos = (0, import_db.all)("select path, name, remote from repos where project_slug = ? order by name", slug);
  const data = await Promise.all(repos.map((r) => repoStatus(r.path, r.name, r.remote, true)));
  cache.set(slug, { at: Date.now(), data });
  return data;
}
async function releaseSummary() {
  const slugs = (0, import_db.all)(`select slug from projects where status <> 'dead'`).map((p) => p.slug);
  return Promise.all(slugs.map(async (slug) => ({ slug, repos: await releaseStatus(slug) })));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isBackMerge,
  parseEntry,
  releaseStatus,
  releaseSummary,
  webUrl
});
