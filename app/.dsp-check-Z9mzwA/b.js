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

// electron/board.ts
var board_exports = {};
__export(board_exports, {
  KINDS: () => KINDS,
  boardBlock: () => boardBlock,
  boardsOfProject: () => boardsOfProject,
  color: () => color,
  createBoard: () => createBoard,
  deleteBoard: () => deleteBoard,
  keyOf: () => keyOf,
  listBoards: () => listBoards,
  listColumns: () => listColumns,
  nextStage: () => nextStage,
  removeFromBoard: () => removeFromBoard,
  resolveBoard: () => resolveBoard,
  resolveStage: () => resolveStage,
  saveColumns: () => saveColumns,
  setStage: () => setStage,
  stagesOf: () => stagesOf,
  updateBoard: () => updateBoard
});
module.exports = __toCommonJS(board_exports);
var import_db = require("C:\\Users\\Gustavo\\Development\\Central\\app\\.dsp-check-Z9mzwA\\db.js");
var KINDS = ["backlog", "todo", "doing", "review", "dev", "done"];
var KIND_LABEL = { backlog: "backlog", todo: "a fazer", doing: "fazendo", review: "revis\xE3o", dev: "em dev", done: "feito" };
var color = (c) => c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
var keyOf = (label) => label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "coluna";
var listColumns = (boardId) => (0, import_db.all)("select key, label, description, kind, agent_id, instruction, parallel, hours, next_key, color from board_cols where board_id = ? order by position", boardId);
var listBoards = () => (0, import_db.all)(`
    select b.id, b.name, b.description, b.project_slug, b.color, b.position, b.created_at,
      (select count(*) from task_boards x join tasks t on t.id = x.task_id where x.board_id = b.id and t."column" <> 'done') open_tasks
    from boards b order by b.position, b.id`).map((b) => ({ ...b, columns: listColumns(b.id) }));
var board = (id) => listBoards().find((b) => b.id === id) ?? null;
function resolveBoard(idOrName) {
  if (typeof idOrName === "number" || /^\d+$/.test(String(idOrName))) return (0, import_db.get)("select id from boards where id = ?", Number(idOrName))?.id ?? null;
  return (0, import_db.get)("select id from boards where lower(name) = lower(?)", String(idOrName).trim())?.id ?? null;
}
function resolveStage(boardId, keyOrLabel) {
  const cols = listColumns(boardId);
  const k = keyOf(keyOrLabel);
  return (cols.find((c) => c.key === keyOrLabel) ?? cols.find((c) => c.key === k) ?? cols.find((c) => c.label.toLowerCase() === keyOrLabel.trim().toLowerCase()))?.key ?? null;
}
function createBoard(i) {
  const name = i.name?.trim();
  if (!name) throw new Error("D\xEA um nome ao quadro.");
  if (i.project_slug && !(0, import_db.get)("select 1 from projects where slug = ?", i.project_slug)) throw new Error("Projeto n\xE3o encontrado.");
  const pos = ((0, import_db.get)("select max(position) p from boards")?.p ?? -1) + 1;
  const id = Number((0, import_db.run)(
    "insert into boards (name, description, project_slug, color, position) values (?,?,?,?,?)",
    name,
    i.description?.trim() || null,
    i.project_slug || null,
    i.color || "#7FA2FF",
    pos
  ).lastInsertRowid);
  saveColumns(id, i.columns?.length ? i.columns : [{ label: "A fazer", kind: "todo" }, { label: "Fazendo", kind: "doing" }, { label: "Pronto", kind: "done" }]);
  return board(id);
}
function updateBoard(id, patch) {
  if (!(0, import_db.get)("select 1 from boards where id = ?", id)) throw new Error("Quadro n\xE3o encontrado.");
  if (patch.name !== void 0 && !patch.name.trim()) throw new Error("D\xEA um nome ao quadro.");
  if (patch.project_slug && !(0, import_db.get)("select 1 from projects where slug = ?", patch.project_slug)) throw new Error("Projeto n\xE3o encontrado.");
  const f = ["name", "description", "project_slug", "color"].filter((k) => patch[k] !== void 0);
  if (f.length) (0, import_db.run)(`update boards set ${f.map((k) => `${k} = ?`).join(", ")} where id = ?`, ...f.map((k) => typeof patch[k] === "string" ? patch[k].trim() || null : patch[k] ?? null), id);
}
function deleteBoard(id) {
  (0, import_db.run)("delete from task_boards where board_id = ?", id);
  (0, import_db.run)("delete from board_cols where board_id = ?", id);
  (0, import_db.run)("delete from boards where id = ?", id);
}
function saveColumns(boardId, input) {
  if (!(0, import_db.get)("select 1 from boards where id = ?", boardId)) throw new Error("Quadro n\xE3o encontrado.");
  if (!input.length) throw new Error("O quadro precisa de pelo menos uma coluna.");
  const used = /* @__PURE__ */ new Set();
  const cols = input.map((c, i) => {
    const label = c.label?.trim();
    if (!label) throw new Error(`A coluna ${i + 1} est\xE1 sem nome.`);
    if (c.kind && !KINDS.includes(c.kind)) throw new Error(`Tipo inv\xE1lido na coluna "${label}".`);
    let key = keyOf(c.key || label);
    for (let n = 2; used.has(key); n++) key = `${keyOf(c.key || label)}-${n}`;
    used.add(key);
    if (c.agent_id && !(0, import_db.get)("select 1 from agents where id = ?", c.agent_id)) throw new Error(`Agente n\xE3o encontrado na coluna "${label}".`);
    if (c.hours && !/^\d{1,2}-\d{1,2}$/.test(c.hours.trim())) throw new Error(`Hor\xE1rio no formato 08-22 na coluna "${label}".`);
    return { ...c, key, label, position: i, parallel: Math.min(Math.max(Number(c.parallel) || 1, 1), 4) };
  });
  for (const c of cols) if (c.next_key && !used.has(keyOf(c.next_key))) throw new Error(`"${c.label}" manda para uma coluna que n\xE3o existe.`);
  (0, import_db.run)("begin");
  try {
    (0, import_db.run)("delete from board_cols where board_id = ?", boardId);
    for (const c of cols) {
      (0, import_db.run)(
        `insert into board_cols (board_id, key, label, description, kind, position, agent_id, instruction, parallel, hours, next_key, color) values (?,?,?,?,?,?,?,?,?,?,?,?)`,
        boardId,
        c.key,
        c.label,
        c.description?.trim() || null,
        c.kind ?? null,
        c.position,
        c.agent_id ?? null,
        c.instruction?.trim() || null,
        c.parallel,
        c.hours?.trim() ?? "",
        c.next_key ? keyOf(c.next_key) : null,
        color(c.color)
      );
    }
    (0, import_db.run)(`update task_boards set stage = ? where board_id = ? and stage not in (${[...used].map(() => "?").join(",")})`, cols[0].key, boardId, ...used);
    (0, import_db.run)("commit");
  } catch (e) {
    (0, import_db.run)("rollback");
    throw e;
  }
  return listColumns(boardId);
}
function setStage(taskId, boardId, key, position = 0) {
  const col = listColumns(boardId).find((c) => c.key === key);
  if (!col) throw new Error(`Coluna "${key}" n\xE3o existe neste quadro.`);
  if (!(0, import_db.get)("select 1 from tasks where id = ?", taskId)) throw new Error("Tarefa n\xE3o encontrada.");
  (0, import_db.run)(
    `insert into task_boards (task_id, board_id, stage, position, updated_at) values (?,?,?,?,?)
       on conflict (task_id, board_id) do update set stage = excluded.stage, position = excluded.position, updated_at = excluded.updated_at`,
    taskId,
    boardId,
    key,
    position,
    (0, import_db.now)()
  );
  if (col.kind) (0, import_db.run)(`update tasks set "column" = ?, updated_at = ? where id = ?`, col.kind, (0, import_db.now)(), taskId);
}
var removeFromBoard = (taskId, boardId) => {
  (0, import_db.run)("delete from task_boards where task_id = ? and board_id = ?", taskId, boardId);
};
var stagesOf = () => (0, import_db.all)("select task_id, board_id, stage, position from task_boards");
function nextStage(boardId, key) {
  const cols = listColumns(boardId);
  const i = cols.findIndex((c) => c.key === key);
  if (i < 0) return null;
  return cols[i].next_key ?? cols[i + 1]?.key ?? null;
}
function boardBlock(boardIds) {
  const boards = listBoards().filter((b) => boardIds.includes(b.id));
  if (!boards.length) return "";
  const agent = (id) => id ? (0, import_db.get)("select name from agents where id = ?", id)?.name ?? null : null;
  return [
    "## Quadros (workflows) em que voc\xEA atua (mova tarefas com move_on_board)",
    ...boards.map((b) => `### ${b.name} [#${b.id}]${b.description ? `: ${b.description}` : ""}
${b.columns.map((c) => `- ${c.label} [${c.key}]${c.description ? `: ${c.description}` : ""}${agent(c.agent_id) ? ` (quem cuida: ${agent(c.agent_id)})` : ""}${c.kind ? ` \xB7 no backlog principal: ${KIND_LABEL[c.kind]}` : ""}`).join("\n")}`)
  ].join("\n");
}
var boardsOfProject = (slug) => (0, import_db.all)(`
  select id from boards where project_slug = ?
  union select distinct x.board_id from task_boards x join tasks t on t.id = x.task_id where t.project_slug = ?`, slug, slug).map((r) => r.id);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KINDS,
  boardBlock,
  boardsOfProject,
  color,
  createBoard,
  deleteBoard,
  keyOf,
  listBoards,
  listColumns,
  nextStage,
  removeFromBoard,
  resolveBoard,
  resolveStage,
  saveColumns,
  setStage,
  stagesOf,
  updateBoard
});
