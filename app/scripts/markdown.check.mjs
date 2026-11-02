// Self-check do renderizador de markdown do chat: `node scripts/markdown.check.mjs`
// Compila src/app/shared/ui/markdown.ts com o esbuild (já instalado) e testa a função markdown().
import { buildSync } from 'esbuild';

const out = buildSync({
  stdin: { contents: "export { markdown } from './src/app/shared/ui/markdown';", resolveDir: new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', external: ['@angular/core'],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text.replace(/import\s*{[^}]*}\s*from\s*"@angular\/core";?/, 'const Pipe = () => () => {};')).toString('base64'));
const md = mod.markdown;

const cases = [
  ['**negrito** e `código`', '<p><strong>negrito</strong> e <code>código</code></p>'],
  ['- um\n- dois', '<ul><li>um</li><li>dois</li></ul>'],
  ['1. a\n2. b', '<ol><li>a</li><li>b</li></ol>'],
  ['## Título', '<h4>Título</h4>'],
  ['```ts\nconst a = 1 < 2;\n```', '<pre><code data-lang="ts">const a = 1 &lt; 2;</code></pre>'],
  ['<script>x</script>', '<p>&lt;script&gt;x&lt;/script&gt;</p>'],
  ['veja https://a.com/x', '<p>veja <a href="https://a.com/x" target="_blank" rel="noopener">https://a.com/x</a></p>'],
  ['`**não negrito**`', '<p><code>**não negrito**</code></p>'],
  ['linha 1\nlinha 2\n\nparágrafo 2', '<p>linha 1<br>linha 2</p><p>parágrafo 2</p>'],
  ['~~velho~~ novo', '<p><del>velho</del> novo</p>'],
  // tabela GFM (a que o agente Central mandou): cabeçalho, alinhamento, `código` com | dentro, texto logo antes sem linha em branco
  ['Resumo:\n| Projeto | Ideias |\n|---|--:|\n| Operação | 1 (PR fora da `main`) |\n| Central | `a|b` |\n\nfim',
   '<p>Resumo:</p><div class="md-table"><table><thead><tr><th>Projeto</th><th class="ar">Ideias</th></tr></thead><tbody>'
   + '<tr><td>Operação</td><td class="ar">1 (PR fora da <code>main</code>)</td></tr>'
   + '<tr><td>Central</td><td class="ar"><code>a|b</code></td></tr></tbody></table></div><p>fim</p>'],
  ['| a | b |\n|---|---|\n| só um |', '<div class="md-table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>só um</td><td></td></tr></tbody></table></div>'],
  ['a | b sem separador', '<p>a | b sem separador</p>'],
];
for (const [src, want] of cases) {
  const got = md(src);
  if (got !== want) throw new Error(`\n${JSON.stringify(src)}\n esperado ${want}\n veio     ${got}`);
}
console.log('ok');
