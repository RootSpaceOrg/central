/**
 * Extração de um arquivo: definições (classes, funções, métodos…), referências (chamadas, tipos, imports, inject)
 * e as ligações do stack (HTTP do Angular → rota; Terraform: rota → lambda → handler Python).
 * tree-sitter (WASM) com as queries de tags do Aider/GitHub; Terraform por regex de blocos (é declarativo e simples).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// web-tree-sitter é ESM+CJS: pelo require funciona no Windows (o import ESM com caminho absoluto falha)
const req = createRequire(__filename);
const TS = req('web-tree-sitter') as typeof import('web-tree-sitter');

export type Lang = 'ts' | 'tsx' | 'js' | 'py' | 'tf';

export interface Def {
  name: string;
  qualname: string;
  kind: string;            // class|interface|type|enum|function|method|component|service|module|tf_resource|lambda
  line_start: number;
  line_end: number;
  signature: string;
  doc: string | null;
  exported: boolean;
}

export interface Ref {
  name: string;
  kind: 'call' | 'type' | 'import' | 'inject' | 'http' | 'tf_ref' | 'handler' | 'selector';
  detail: string | null;   // origem do import, rota normalizada, handler "app.main.handler"…
  line: number;
}

export interface Extracted { defs: Def[]; refs: Ref[] }

export const LANG_BY_EXT: Record<string, Lang> = {
  ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', py: 'py', tf: 'tf',
};

const EXTRA_TS = `
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.enum
(class_declaration name: (type_identifier) @name) @definition.class
(public_field_definition name: (property_identifier) @name value: [(arrow_function) (function_expression)]) @definition.method
(import_statement (import_clause (named_imports (import_specifier name: (identifier) @import.name))) source: (string (string_fragment) @import.source))
(import_statement (import_clause (identifier) @import.name) source: (string (string_fragment) @import.source))
`;
const EXTRA_PY = `
(import_from_statement module_name: (_) @import.source name: (dotted_name) @import.name)
(import_from_statement module_name: (_) @import.source name: (aliased_import name: (dotted_name) @import.name))
(import_statement name: (dotted_name) @import.source)
`;

interface Grammar { lang: import('web-tree-sitter').Language; query: import('web-tree-sitter').Query }
let parser: import('web-tree-sitter').Parser | null = null;
const grammars = new Map<Lang, Grammar>();

const modDir = (pkg: string) => dirname(req.resolve(`${pkg}/package.json`));

/** Carrega o runtime e as gramáticas uma vez (≈10 ms). */
export async function initParsers(): Promise<void> {
  if (parser) return;
  await TS.Parser.init();
  parser = new TS.Parser();
  const js = readFileSync(join(modDir('tree-sitter-javascript'), 'queries', 'tags.scm'), 'utf8');
  const ts = readFileSync(join(modDir('tree-sitter-typescript'), 'queries', 'tags.scm'), 'utf8');
  const py = readFileSync(join(modDir('tree-sitter-python'), 'queries', 'tags.scm'), 'utf8');
  const load = async (file: string, scm: string) => {
    const lang = await TS.Language.load(file);
    return { lang, query: new TS.Query(lang, scm) };
  };
  const tsDir = modDir('tree-sitter-typescript');
  grammars.set('ts', await load(join(tsDir, 'tree-sitter-typescript.wasm'), js + ts + EXTRA_TS));
  grammars.set('tsx', await load(join(tsDir, 'tree-sitter-tsx.wasm'), js + ts + EXTRA_TS));
  grammars.set('js', await load(join(modDir('tree-sitter-javascript'), 'tree-sitter-javascript.wasm'), js));
  grammars.set('py', await load(join(modDir('tree-sitter-python'), 'tree-sitter-python.wasm'), py + EXTRA_PY));
}

const KIND: Record<string, string> = {
  class: 'class', interface: 'interface', type: 'type', enum: 'enum', function: 'function', method: 'method', module: 'module', constant: 'variable',
};

/** Nome da classe em volta (para "Classe.metodo"). */
function owner(n: import('web-tree-sitter').Node): string | null {
  for (let p = n.parent; p; p = p.parent) {
    if (/^(class_declaration|abstract_class_declaration|class|class_definition)$/.test(p.type)) return p.childForFieldName('name')?.text ?? null;
  }
  return null;
}

const firstLine = (s: string) => s.split('\n')[0].trim().slice(0, 160);

export function extract(path: string, lang: Lang, src: string): Extracted {
  if (lang === 'tf') return extractTerraform(src);
  const g = grammars.get(lang);
  if (!g || !parser) throw new Error('parsers não carregados');
  parser.setLanguage(g.lang);
  const tree = parser.parse(src);
  if (!tree) return { defs: [], refs: [] };
  const defs: Def[] = [];
  const refs: Ref[] = [];
  const seen = new Set<string>();
  try {
    for (const m of g.query.matches(tree.rootNode)) {
      const name = m.captures.find(c => c.name === 'name')?.node;
      const def = m.captures.find(c => c.name.startsWith('definition.'));
      const ref = m.captures.find(c => c.name.startsWith('reference.'));
      const imp = m.captures.find(c => c.name === 'import.name');
      const impSrc = m.captures.find(c => c.name === 'import.source');
      if (impSrc) {
        const source = impSrc.node.text;
        refs.push({ name: imp?.node.text ?? source.split('.').pop()!, kind: 'import', detail: source, line: impSrc.node.startPosition.row + 1 });
        continue;
      }
      if (!name) continue;
      if (def) {
        const n = def.node;
        const k = def.name.slice('definition.'.length);
        const cls = k === 'method' ? owner(n) : k === 'function' && lang === 'py' ? owner(n) : null;
        const qualname = cls ? `${cls}.${name.text}` : name.text;
        const id = `${qualname}@${n.startPosition.row}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const text = src.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 400));
        defs.push({
          name: name.text, qualname, kind: cls && lang === 'py' ? 'method' : KIND[k] ?? k,
          line_start: n.startPosition.row + 1, line_end: n.endPosition.row + 1,
          signature: firstLine(text), doc: m.captures.find(c => c.name === 'doc')?.node.text.replace(/^[\s*/#]+/, '').split('\n')[0].slice(0, 160) || null,
          exported: n.parent?.type === 'export_statement' || (lang === 'py' && !name.text.startsWith('_')),
        });
      } else if (ref) {
        refs.push({ name: name.text, kind: ref.name === 'reference.call' ? 'call' : 'type', detail: null, line: name.startPosition.row + 1 });
      }
    }
  } finally {
    tree.delete();
  }
  if (lang === 'ts' || lang === 'tsx') angular(src, defs, refs);
  return { defs, refs };
}

const lineAt = (src: string, index: number) => src.slice(0, index).split('\n').length;

/** Normaliza uma URL ou route_key para comparar front e back: "/templates/{}" (parâmetros viram {}). */
export function normalizeRoute(url: string): string {
  let u = url.trim().replace(/^https?:\/\/[^/]+/, '');
  u = u.replace(/^\$\{[^}]+\}/, '');                 // ${environment.api}/x → /x
  u = u.replace(/\$\{[^}]+\}|\{[^}]+\}|:[A-Za-z_]\w*/g, '{}');
  u = u.split('?')[0];
  if (!u.startsWith('/')) u = `/${u}`;
  return u.replace(/\/+$/, '') || '/';
}

/** Angular: @Component/@Injectable mudam o tipo; inject(X) e tipos do construtor viram "injeta"; chamadas HTTP viram rotas. */
function angular(src: string, defs: Def[], refs: Ref[]): void {
  for (const m of src.matchAll(/@(Component|Injectable|Directive|Pipe)\s*\(([\s\S]*?)\)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g)) {
    const d = defs.find(x => x.name === m[3] && x.kind === 'class');
    if (d) d.kind = m[1] === 'Injectable' ? 'service' : 'component';
    const sel = /selector:\s*['"`]([^'"`]+)['"`]/.exec(m[2]);
    if (d && sel) d.doc = d.doc ?? `<${sel[1]}>`;
  }
  for (const m of src.matchAll(/\binject\(\s*([A-Z]\w+)/g)) refs.push({ name: m[1], kind: 'inject', detail: null, line: lineAt(src, m.index!) });
  for (const m of src.matchAll(/constructor\s*\(([^)]*)\)/g)) {
    for (const p of m[1].matchAll(/:\s*([A-Z]\w+)/g)) refs.push({ name: p[1], kind: 'inject', detail: null, line: lineAt(src, m.index!) });
  }
  for (const m of src.matchAll(/\.(get|post|put|patch|delete)\s*(?:<[^>()]*>)?\(\s*([`'"])((?:(?!\2).)+)\2/g)) {
    const url = m[3];
    if (!/\/|\$\{/.test(url)) continue;
    const route = normalizeRoute(url);
    // "/{}" (URL toda variável) não diz para onde vai: ligaria tudo com tudo
    if (!/[a-z]/i.test(route)) continue;
    refs.push({ name: `${m[1].toUpperCase()} ${route}`, kind: 'http', detail: url, line: lineAt(src, m.index!) });
  }
  // <app-x> nos templates inline
  for (const m of src.matchAll(/<(app-[\w-]+)/g)) refs.push({ name: m[1], kind: 'selector', detail: null, line: lineAt(src, m.index!) });
}

/** Seletores <app-x> usados num template .html (o componente dono é o .ts de mesmo nome). */
export function extractHtml(src: string): Ref[] {
  return [...src.matchAll(/<(app-[\w-]+)/g)].map(m => ({ name: m[1], kind: 'selector' as const, detail: null, line: lineAt(src, m.index!) }));
}

/** Terraform: cada bloco resource/module vira um nó; route_key, handler e referências a outros recursos viram ligações. */
export function extractTerraform(src: string): Extracted {
  const defs: Def[] = [];
  const refs: Ref[] = [];
  const head = /^(resource|module|data)\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{/gm;
  for (const m of src.matchAll(head)) {
    // corpo do bloco: casa as chaves
    let depth = 0, end = m.index! + m[0].length - 1;
    for (let i = end; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { end = i; break; }
    }
    const body = src.slice(m.index! + m[0].length, end);
    const line = lineAt(src, m.index!);
    const kind = m[1] === 'module' ? 'tf_module' : m[2] === 'aws_lambda_function' ? 'lambda' : 'tf_resource';
    const name = m[1] === 'module' ? `module.${m[2]}` : m[1] === 'data' ? `data.${m[2]}.${m[3]}` : `${m[2]}.${m[3]}`;
    defs.push({ name, qualname: name, kind, line_start: line, line_end: lineAt(src, end), signature: firstLine(m[0]), doc: null, exported: true });
    const attr = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, 'm').exec(body)?.[1] ?? null;
    const route = attr('route_key');
    if (route && route !== '$default') {
      const [verb, ...path] = route.split(' ');
      refs.push({ name: `${verb.toUpperCase()} ${normalizeRoute(path.join(' '))}`, kind: 'http', detail: name, line });
    }
    const handler = attr('handler');
    if (handler) refs.push({ name: handler.split('.').pop()!, kind: 'handler', detail: handler, line });
    const source = attr('source');
    if (m[1] === 'module' && source) refs.push({ name: source, kind: 'import', detail: source, line });
    for (const r of new Set([...body.matchAll(/\b((?:data\.)?aws_[a-z0-9_]+\.[A-Za-z0-9_-]+|module\.[A-Za-z0-9_-]+)\b/g)].map(x => x[1]))) {
      refs.push({ name: r, kind: 'tf_ref', detail: null, line });
    }
  }
  return { defs, refs };
}
