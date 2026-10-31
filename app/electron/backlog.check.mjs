// Self-check do filtro de arquivos de plano do importador: `node electron/backlog.check.mjs`
const src = await (await import('node:fs/promises')).readFile(new URL('./backlog.ts', import.meta.url), 'utf8');
const re = eval(src.match(/export const PLAN_FILE = (\/.+\/i);/)[1]);

const cases = {
  'METODOLOGIA.md': false, 'explanation.md': false, 'planilha.txt': false,
  'PLAN-portal.md': true, 'ROADMAP.md': true, 'matriz-nova-lacunas.md': true, 'NIGHT2-PLAN.md': true,
  'EDITOR-PLAN.md': true, 'todo.md': true, 'ROADMAP_FASE7.md': true,
};
for (const [file, want] of Object.entries(cases)) {
  if (re.test(file) !== want) throw new Error(`${file}: esperado ${want}`);
}
console.log('ok');
