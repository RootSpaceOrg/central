// Self-check do motor de contexto (extração + ranking): `node scripts/context.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// dentro do app: o require de web-tree-sitter acha o node_modules
const dir = mkdtempSync(join(root, '.ctx-check-'));
await build({
  entryPoints: { extract: join(root, 'electron/context/extract.ts'), rank: join(root, 'electron/context/rank.ts'),
    view: join(root, 'src/app/modules/project/pages/project-page/components/context/code-view.ts') },
  outdir: dir, bundle: true, platform: 'node', format: 'cjs', external: ['web-tree-sitter'], logLevel: 'error',
});
const require = createRequire(join(root, 'package.json'));
const x = require(join(dir, 'extract.js'));
const r = require(join(dir, 'rank.js'));
const v = require(join(dir, 'view.js'));
rmSync(dir, { recursive: true, force: true });

const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
await x.initParsers();

const ts = x.extract('a.ts', 'ts', `
import { Injectable, inject } from '@angular/core';
import { HttpService } from '../http/http.service';
/** Lista e salva templates. */
@Injectable({ providedIn: 'root' })
export class TemplateApiService {
  private readonly http = inject(HttpService);
  list(brand: string) { return this.http.get<Template[]>(\`\${environment.api}/brands/\${brand}/templates\`); }
  save(t: Template) { return this.http.post('/templates', t); }
}
export interface Template { id: string }
export type Kind = 'post' | 'story';
export const helper = (a: number) => a + 1;
`);
const names = ts.defs.map(d => `${d.kind}:${d.qualname}`);
ok(names.includes('service:TemplateApiService'), `@Injectable vira service: ${names}`);
ok(names.includes('method:TemplateApiService.list'), `método qualificado: ${names}`);
ok(names.includes('interface:Template') && names.includes('type:Kind') && names.includes('function:helper'), `interface/type/arrow: ${names}`);
ok(ts.refs.some(f => f.kind === 'inject' && f.name === 'HttpService'), 'inject(X)');
ok(ts.refs.some(f => f.kind === 'import' && f.name === 'HttpService' && f.detail === '../http/http.service'), 'import nomeado');
ok(ts.refs.some(f => f.kind === 'http' && f.name === 'GET /brands/{}/templates'), `http normalizado: ${ts.refs.filter(f => f.kind === 'http').map(f => f.name)}`);
ok(ts.refs.some(f => f.kind === 'http' && f.name === 'POST /templates'), 'http post');

const py = x.extract('m.py', 'py', `
from app.services.templates import list_templates
import json

class Repo:
    def get(self, id):
        return json.loads(id)

def handler(event, context):
    return list_templates(event["brand"])
`);
const pn = py.defs.map(d => `${d.kind}:${d.qualname}`);
ok(pn.includes('class:Repo') && pn.includes('method:Repo.get') && pn.includes('function:handler'), `python defs: ${pn}`);
ok(py.refs.some(f => f.kind === 'call' && f.name === 'list_templates'), 'python call');
ok(py.refs.some(f => f.kind === 'import' && f.name === 'list_templates'), 'python import');

const tf = x.extractTerraform(`
resource "aws_lambda_function" "templates" {
  function_name = "templates"
  handler       = "app.main.handler"
  role          = aws_iam_role.lambda.arn
}
resource "aws_apigatewayv2_integration" "templates" {
  integration_uri = aws_lambda_function.templates.invoke_arn
}
resource "aws_apigatewayv2_route" "list" {
  route_key = "GET /brands/{brand}/templates"
  target    = "integrations/\${aws_apigatewayv2_integration.templates.id}"
}
`);
ok(tf.defs.some(d => d.kind === 'lambda' && d.name === 'aws_lambda_function.templates'), 'lambda');
ok(tf.refs.some(f => f.kind === 'handler' && f.name === 'handler' && f.detail === 'app.main.handler'), 'handler');
ok(tf.refs.some(f => f.kind === 'http' && f.name === 'GET /brands/{}/templates'), 'rota do gateway casa com a do Angular');
ok(tf.refs.some(f => f.kind === 'tf_ref' && f.name === 'aws_apigatewayv2_integration.templates'), 'ref entre recursos');

// PageRank personalizado: semente no 3 com 3→4 puxa o 4 acima do 2
const pr = r.ppr(5, [[0, 1, 1], [1, 2, 1], [3, 4, 1], [2, 0, 1]], new Map([[3, 1]]));
ok(pr[4] > pr[2], 'ppr segue a semente');
ok(Math.abs(pr.reduce((a, b) => a + b, 0) - 1) < 1e-6, 'ppr soma 1');
ok(x.normalizeRoute('https://api.x.com/v1/:id?x=1') === '/v1/{}', 'rota normalizada');
// mapa por pastas: raiz mostra repositórios; dentro de uma pasta, subpastas viram caixas e o resto do projeto só aparece se ligado
const node = (repo, path, lang = 'ts') => ({ key: `p/${repo}:${path}`, kind: 'file', label: path.split('/').pop(), repo, path, lang, rank: 1, defs: 1, facts: 0, touches: 0 });
const g = { nodes: [node('web', 'src/a.ts'), node('web', 'src/x/b.ts'), node('web', 'src/x/c.ts'), node('api', 'h.py', 'py'), node('api', 'z.py', 'py')],
  edges: [{ source: 'p/web:src/a.ts', target: 'p/web:src/x/b.ts', kinds: ['imports'], weight: 1 }, { source: 'p/web:src/x/c.ts', target: 'p/api:h.py', kinds: ['http_calls'], weight: 1 }] };
const top = v.buildView(g, []);
ok(top.nodes.map(n => n.id).sort().join() === 'dir:api,dir:web', `raiz = repositórios: ${top.nodes.map(n => n.id)}`);
const src = v.buildView(g, ['web', 'src']);
ok(src.nodes.some(n => n.id === 'p/web:src/a.ts') && src.nodes.some(n => n.id === 'dir:web/src/x' && n.label.includes('2')), `pasta: ${src.nodes.map(n => n.id)}`);
ok(src.edges.some(e => e.source === 'p/web:src/a.ts' && e.target === 'dir:web/src/x'), 'ligação até a subpasta');
ok(src.nodes.some(n => n.id === 'dir:api' && n.label.startsWith('↗')) && src.edges.some(e => e.target === 'dir:api' && e.color === '#B48CFF'), 'área de fora ligada (rota/stack)');
ok(!v.buildView({ nodes: g.nodes, edges: [] }, ['web', 'src']).nodes.some(n => n.id === 'dir:api'), 'área de fora sem ligação some');
console.log('ok');
