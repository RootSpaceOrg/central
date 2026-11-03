// Roda todos os self-checks e falha se algum falhar: `npm run check` (o release só sai depois disto).
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = [...readdirSync('scripts').filter(f => f.endsWith('.check.mjs')).map(f => `scripts/${f}`),
  ...readdirSync('electron').filter(f => f.endsWith('.check.mjs')).map(f => `electron/${f}`)];
let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, [f], { stdio: 'pipe' }); console.log(`ok   ${f}`); }
  catch (e) { failed++; console.log(`FAIL ${f}\n${String(e.stderr ?? e).split('\n').filter(l => /Error/.test(l)).slice(0, 2).join('\n')}`); }
}
if (failed) { console.log(`${failed} check(s) falharam`); process.exit(1); }
