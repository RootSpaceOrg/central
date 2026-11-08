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
  // referências: tarefa e execução viram link; PR, ideia, código e links ficam como estão
  ['resolver #67 e a execução #34', '<p>resolver <a href="#tarefa-67" class="ref-link" title="Abrir a tarefa #67">#67</a> e a execução <a href="#execucao-34" class="ref-link" title="Abrir a execução #34">#34</a></p>'],
  ['PR #14, ideia #49 e `#12`', '<p>PR #14, ideia #49 e <code>#12</code></p>'],
  ['Release #22 em prod', '<p>Release #22 em prod</p>'],
  // caminhos locais: viram link de abrir (também em código); pontuação do fim fica fora; URL não
  [String.raw`Abra C:\Users\G\proto\index.html no Chrome.`, String.raw`<p>Abra <a href="#abrir:C%3A%5CUsers%5CG%5Cproto%5Cindex.html" class="ref-link path-link" title="Abrir C:\Users\G\proto\index.html">C:\Users\G\proto\index.html</a> no Chrome.</p>`],
  ['veja `/Users/g/app/README.md`', '<p>veja <code><a href="#abrir:%2FUsers%2Fg%2Fapp%2FREADME.md" class="ref-link path-link" title="Abrir /Users/g/app/README.md">/Users/g/app/README.md</a></code></p>'],
  // links sem esquema (o agente escreve github.com/...): abrem no navegador; ponto/parêntese do fim ficam fora
  ['PR #1 para main (github.com/G/livros/pull/1). 1) ok', '<p>PR #1 para main (<a href="https://github.com/G/livros/pull/1" target="_blank" rel="noopener">github.com/G/livros/pull/1</a>). 1) ok</p>'],
  ['veja https://app.x.dev/a?b=1.', '<p>veja <a href="https://app.x.dev/a?b=1" target="_blank" rel="noopener">https://app.x.dev/a?b=1</a>.</p>'],
  ['arquivos css/pagina.css e aulas.json', '<p>arquivos css/pagina.css e aulas.json</p>'],
  ['https://x.com/Users/a','<p><a href="https://x.com/Users/a" target="_blank" rel="noopener">https://x.com/Users/a</a></p>'],
  ['[ver](https://x.com/a#12) e (#76)', '<p><a href="https://x.com/a#12" target="_blank" rel="noopener">ver</a> e (<a href="#tarefa-76" class="ref-link" title="Abrir a tarefa #76">#76</a>)</p>'],
];
for (const [src, want] of cases) {
  const got = md(src);
  if (got !== want) throw new Error(`\n${JSON.stringify(src)}\n esperado ${want}\n veio     ${got}`);
}
console.log('ok');
