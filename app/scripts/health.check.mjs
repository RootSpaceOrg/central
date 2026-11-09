// Self-check da saúde dos projetos (Visão geral): `node scripts/health.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'health-'));
const out = join(dir, 'health.mjs');
await build({ entryPoints: [new URL('../src/app/modules/overview/health.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], outfile: out, format: 'esm', logLevel: 'error' });
const { health } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const ok = (c, m) => { if (!c) throw new Error(m); };
const NOW = Date.parse('2026-11-02T12:00:00Z');
const ago = d => new Date(NOW - d * 86_400_000);
const base = {
  status: 'active', folderExists: true, lastCommitAt: ago(1), dirtyRepos: 0, openProposals: 0, tasks: [], newIdeas: 0,
  failedRuns7d: 0, activeRuns: 0, nowMilestones: 1, nowWithoutTasks: 0, rumoAt: ago(5),
};
const t = (column, priority = 2, updated = 1, title = 'x') => ({ column, priority, updatedAt: ago(updated), title });

ok(health(base, NOW).health === 'ok', 'tudo em dia = saudável');
ok(health({ ...base, folderExists: false }, NOW).health === 'risco', 'pasta sumiu = risco');
ok(health({ ...base, tasks: [t('todo', 0, 1, 'Corrigir login')] }, NOW).signals[0].text.includes('Corrigir login'), 'prioritária mostra o título');
ok(health({ ...base, tasks: [t('done', 0)] }, NOW).health === 'ok', 'urgente feita não conta');
ok(health({ ...base, failedRuns7d: 2 }, NOW).health === 'risco', 'execução falhou = risco');
ok(health({ ...base, openProposals: 1 }, NOW).health === 'atencao', 'decisão = atenção');
ok(health({ ...base, tasks: [t('doing', 2, 10)] }, NOW).signals.some(s => s.text.includes('parada')), 'fazendo há 10 dias = travada');
ok(!health({ ...base, tasks: [t('doing', 2, 3)] }, NOW).signals.length, 'fazendo há 3 dias = normal');
ok(health({ ...base, rumoAt: null }, NOW).signals.some(s => s.go === 'rumo'), 'sem rumo');
ok(health({ ...base, rumoAt: ago(60) }, NOW).signals.some(s => s.text.includes('60 dias')), 'rumo velho');
ok(health({ ...base, nowMilestones: 0 }, NOW).signals.some(s => s.go === 'roadmap'), 'nada em Agora');
ok(health({ ...base, lastCommitAt: ago(40) }, NOW).health === 'parado', '40 dias sem commit = parado');
ok(health({ ...base, lastCommitAt: ago(40), activeRuns: 1 }, NOW).health === 'ok', 'agente trabalhando não está parado');
ok(health({ ...base, lastCommitAt: ago(40), failedRuns7d: 1 }, NOW).health === 'risco', 'risco vence parado');
// manutenção cobra menos; congelado só risco
ok(health({ ...base, status: 'maintenance', rumoAt: null, nowMilestones: 0, lastCommitAt: ago(90) }, NOW).health === 'ok', 'manutenção sem rumo/marco/ritmo = ok');
ok(health({ ...base, status: 'frozen', openProposals: 3, rumoAt: null }, NOW).health === 'ok', 'congelado ignora atenção');
ok(health({ ...base, status: 'frozen', folderExists: false }, NOW).health === 'risco', 'congelado ainda acusa risco');
ok(health({ ...base, tasks: [t('dev', 2, 9)] }, NOW).signals.some(s => s.go === 'producao'), 'em dev há 9 dias = esperando produção');
ok(!health({ ...base, tasks: [t('dev', 2, 2)] }, NOW).signals.length, 'em dev há 2 dias = normal');
console.log('health ok');
