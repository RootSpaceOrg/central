# Contexto de código para os agentes da Central: repo maps, grafos de código e memória de projeto

> Pesquisa técnica de 02/11/2026. Fontes primárias: repositórios no GitHub, papers no arXiv, documentação oficial e o npm registry.
> Estrelas e números de versão foram lidos nas páginas e no `npm view` nessa data.
> Os números de benchmark dos fornecedores estão marcados como **autodeclarados**.
> Os testes rodados aqui (seção 4.0) usaram Node 24.13 e o Electron 45.2.1 do próprio projeto (Node 24.22.1).

---

## 1. Resumo executivo

**Recomendação:** construir na Central um **índice de código próprio, pequeno e embutido**: tree-sitter em WASM, grafo em SQLite, PageRank personalizado no estilo Aider e FTS5. Por cima dele, uma **camada de memória de projeto** com fatos que carregam proveniência e validade temporal e apontam para nós do grafo. Isso entra nos agentes por dois canais:

1. **Injeção fixa e barata no prompt:** cerca de 1,5–2,5k tokens via o `--append-system-prompt-file` que a Central já gera. Contém um *repo map* ranqueado pelo foco da tarefa e os 5–10 fatos de memória mais relevantes.
2. **Ferramentas MCP sob demanda** no servidor MCP que já existe: `code_map`, `code_search`, `code_symbol`, `code_neighbors`, `code_impact`, `memory_recall`, `memory_remember` e `memory_supersede`.

**Por que essa combinação e não outra:**

- **O que as evidências mostram.** Grafo e mapa estrutural reduzem muito o consumo de tokens e de chamadas de ferramenta, mas **não aumentam a qualidade de forma automática**.
  - No paper do Codebase-Memory, o agente com grafo gastou **~10× menos tokens e 2,1× menos chamadas**, mas teve qualidade de 0,83 contra 0,92 do agente que explora arquivos ([arXiv 2603.27277](https://arxiv.org/abs/2603.27277)).
  - O RepoGraph acrescenta **+2 a +2,7 pontos** de resolução no SWE-bench Lite em quatro frameworks diferentes ([arXiv 2410.14684](https://arxiv.org/html/2410.14684v2)).
  - O LocAgent leva a localização de arquivo (Acc@5) de 79,6% (Agentless) para **94,2%** ([arXiv 2503.09089](https://arxiv.org/html/2503.09089v2)).
  - A conclusão prática: **o grafo serve para navegar e encontrar código, não substitui ler o código.** O agente continua com Read/Grep; o grafo diz *onde* ler.
- **Banco de grafo dedicado não se paga.** O Kuzu foi arquivado em out/2025 e só sobrevive no fork LadybugDB. Neo4j e FalkorDB exigem servidor. Os projetos mais usados de 2026 (codebase-memory-mcp, CodeGraph, code-graph-rag na configuração padrão) convergiram para **SQLite com FTS5**, e o `node:sqlite` do Electron 45 da Central já tem FTS5 e carrega extensões. Testei as duas coisas.
- **Embeddings ficam fora da v1.**
  - A favor: o Cursor mediu +12,5% de acurácia média com busca semântica, com ganho maior em repositórios com mais de 1.000 arquivos ([Cursor](https://cursor.com/blog/semsearch)).
  - Contra: o Claude Code abandonou o RAG vetorial em favor da busca agêntica, e o CodeGraph, que é o líder em adoção, não usa vetor nenhum.
  - Os repositórios de um dev solo são pequenos a médios. FTS5 com tokens de identificador e o grafo cobrem a maior parte dos casos.
  - O caminho fica pronto e testado (`sqlite-vec` 0.1.9 carregou dentro do Electron 45) para uma fase 3, se a medição pedir.
- **Por que construir em vez de plugar um MCP pronto.** O diferencial está nas arestas **entre linguagens do seu stack**, que nenhuma ferramenta pronta liga de ponta a ponta:
  - `HttpClient` do Angular → `route_key` do API Gateway no Terraform → `aws_lambda_function.handler` → função Python.
  - Também está a integração com o que a Central já tem: projetos, repos, commits, tarefas, decisões, runs e a tela de grafo.
  - Tudo cabe em cerca de 2–3k linhas de TypeScript sem nenhum serviço externo.
  - Para ter uma **linha de base medida antes de construir**, vale plugar o `codebase-memory-mcp` (MIT, binário C, SQLite, indexa Terraform) por uma ou duas semanas via `--mcp-config` e comparar o `cost_usd` das runs.

**Tela de grafo:** **sigma 4.0.4 + graphology 0.26.0** (WebGL, MIT, sem React, é a mesma base que o GitNexus usa). Layout ForceAtlas2 em web worker, com as posições guardadas no SQLite. Comunidades com Louvain. Níveis de detalhe projeto → repo → pasta → arquivo → símbolo, e camadas de código, memória, backlog e "o que o agente consultou".

---

## 2. Tabela comparativa

Legenda: **Local** significa 100% local sem chave de API. "Ganho medido" traz o que a própria fonte reporta.

| Ferramenta | O que indexa | Armazenamento | Como o agente consulta | Local | Licença | Linguagem | Maturidade (nov/2026) | Ganho medido |
|---|---|---|---|---|---|---|---|---|
| **Aider repo map** ([doc](https://aider.chat/2023/10/22/repomap.html), [código](https://github.com/Aider-AI/aider/blob/main/aider/repomap.py)) | defs/refs via `tags.scm` do tree-sitter | cache diskcache (SQLite) por mtime | mapa injetado no prompt (padrão 1k tokens, até 8× sem arquivos no chat) | sim | Apache-2.0 | Python | muito madura, referência do gênero | 26,3% no SWE-bench Lite (mai/2024); arquivo certo localizado em 70,3% ([aider](https://aider.chat/2024/05/22/swe-bench-lite.html)). Sem ablação isolada do mapa |
| **codebase-memory-mcp** ([repo](https://github.com/DeusData/codebase-memory-mcp), [paper](https://arxiv.org/html/2603.27277v1)) | 66–162 linguagens, rotas HTTP, Terraform/K8s/Docker, docs | SQLite + FTS5, `~/.cache/...` | 14–17 ferramentas MCP (search_graph, trace_call_path, query_graph tipo Cypher, detect_changes, manage_adr…) | sim | MIT | C | ~48k★, paper de mar/2026 | **~10× menos tokens, 2,1× menos chamadas, qualidade 0,83 contra 0,92** (31 repos, Opus 4.6) |
| **CodeGraph** ([repo](https://github.com/colbymchenry/codegraph)) | símbolos, calls, imports, extends | `node:sqlite` WAL + FTS5, `.codegraph/codegraph.db` | 1 ferramenta padrão `codegraph_explore` (outras 7 opcionais) + seção em CLAUDE.md | sim | MIT | Rust (parser) + Node | ~76k★ | autodeclarado: **−62% tokens, −88% chamadas, −44% custo** (7 repos, mediana de 4 runs). Django: −41% tokens |
| **GitNexus** ([repo](https://github.com/abhigyanpatwari/GitNexus)) | símbolos, calls, fluxos de execução | LadybugDB (ex-Kuzu) com vetores | MCP: query, context, impact, trace, detect_changes, rename + explorador web (sigma.js) | sim (embeddings remotos opcionais) | **PolyForm Noncommercial** | TS | ~48k★ | sem benchmark publicado |
| **Serena** ([repo](https://github.com/oraios/serena)) | símbolos via LSP ao vivo (40+ linguagens), sem índice persistido | arquivos de memória em markdown | find_symbol, find_referencing_symbols, replace_symbol_body, insert_after_symbol… | sim | GPL-3.0+ (núcleo SolidLSP MIT) | Python | ~31k★, v2 | só qualitativo ("much more token-efficient") |
| **code-graph-rag** ([repo](https://github.com/vitali87/code-graph-rag)) | tree-sitter + frontends de compilador opcionais + traces de runtime | SQLite (padrão) / Memgraph / Neo4j | MCP com LLM gerando Cypher | o grafo sim; o LLM depende | MIT | Python | 5,3k★ | sem números |
| **Codanna** ([crate](https://docs.rs/crate/codanna/0.4.0)) | símbolos, call graph, docstrings | Tantivy + mmap + embeddings 384d (MiniLM) | MCP stdio/HTTP | sim | Apache-2.0 | Rust | ~700★, Windows experimental | "<10 ms por lookup" (autodeclarado) |
| **CodeGraphContext** ([repo](https://github.com/biggraph-ai/CodeGraphContext)) | tree-sitter, SCIP opcional | Kuzu/LadybugDB, FalkorDB Lite (não roda no Windows), Neo4j | MCP | sim | MIT | Python | média | — |
| **Blarify** ([repo](https://github.com/blarApp/blarify)) | grafo via LSP/SCIP | Neo4j/FalkorDB | lib (sem MCP) | precisa de servidor de grafo | MIT | Python | 233★, sem incremental | SCIP "até 330× mais rápido que LSP" |
| **Potpie** ([repo](https://github.com/potpie-ai/potpie)) | "context graph" de código, decisões e histórico | daemon local | CLI + skills para Claude Code/Codex | parcial (LLM) | Apache-2.0 | Python | 5,8k★ | — |
| **Sourcegraph SCIP** ([proto](https://github.com/sourcegraph/scip/blob/main/scip.proto)) | refs/defs **precisas** do compilador (`@sourcegraph/scip-typescript` 0.6.0, `@sourcegraph/scip-python` 0.6.8) | arquivo protobuf `index.scip` | é formato de índice, não um MCP | sim | Apache-2.0 / MIT | — | madura | precisão de compilador, mas lento e sem incremental |
| **Repomix** ([repo](https://github.com/yamadashy/repomix)) | empacota o repo inteiro; `--compress` mantém só assinaturas (tree-sitter) | arquivo único | MCP pack_codebase / grep_repomix_output | sim | MIT | TS | 29k★ | ~70% de redução com `--compress` (autodeclarado). Útil para "context packing", não para navegar |
| **Graphiti/Zep** ([repo](https://github.com/getzep/graphiti), [paper](https://arxiv.org/abs/2501.13956)) | memória temporal: episódios → entidades/fatos com janela de validade | Neo4j/FalkorDB/Neptune (Kuzu descontinuado) | MCP de referência | só com LLM local (avisa que JSON de modelo pequeno quebra) | Apache-2.0 | Python | 32k★ | paper da Zep: DMR 94,8%, LongMemEval até +18,5% (autodeclarado) |
| **Cognee** ([repo](https://github.com/topoteretes/cognee)) | documentos, código e conversas → grafo | backends plugáveis | MCP + plugin para Claude Code | sim, com GLiNER e embedding local | Apache-2.0 | Python | 33k★ | — |
| **claude-mem** ([repo](https://github.com/thedotmack/claude-mem)) | observações das sessões via hooks do Claude Code, comprimidas por LLM | SQLite + FTS5 + Chroma | MCP search → timeline → get_observations (divulgação progressiva) | **não estritamente** (observer hospedado por padrão; opt-out) | Apache-2.0 | TS/Bun | ~110k★ | "~10× economia" (autodeclarado) |
| **Basic Memory** ([repo](https://github.com/basicmachines-co/basic-memory)) | notas markdown com `- [categoria] fato` e `- relação [[Alvo]]` | arquivos .md + índice SQLite (FastEmbed híbrido) | bm_write, bm_search, bm_context… | sim | **AGPL-3.0** | Python | 4,5k★ | — |
| **mem0 / OpenMemory** ([mem0-local-mcp](https://glama.ai/mcp/servers/sanchezvivi/mem0-local-mcp/tree)) | fatos extraídos por LLM | Qdrant (+ Neo4j no modo grafo) | add/search memory | só com Qdrant + Ollama locais | Apache-2.0 | Python | — | paper do mem0: −90% tokens contra contexto completo (autodeclarado) |
| **Memória do Claude Code** ([doc](https://code.claude.com/docs/en/memory)) | CLAUDE.md, `.claude/rules/` com `paths:`, auto memory | markdown; auto memory em `~/.claude/projects/<proj>/memory/` | carregado no início (MEMORY.md: primeiras 200 linhas ou 25 KB); CLAUDE.md de subpasta carrega sob demanda | sim | — | — | nativa | a doc recomenda CLAUDE.md com menos de 200 linhas. A auto memory **não guarda arquitetura derivável do código**, então é complementar ao grafo |
| **zilliz/claude-context** | chunks AST + híbrido BM25/vetor | Milvus | search_code | só com Milvus + Ollama | MIT | TS | — | "−40% tokens" (autodeclarado). A doc diz incompatível com Node 24.0.0 |

**Precisão do grafo de chamadas:** um benchmark independente, ainda que feito pelo autor de um concorrente, comparou com call graphs gerados pelo compilador em 5 repos Go e TS, 37.853 arestas ([repowise](https://repowise.dev/blog/comparisons/best-code-graph-mcp-servers)). Precisão e recall variam muito por repositório:

| Ferramenta | Precisão | Recall |
|---|---|---|
| CodeGraph | 0,73–0,97 | 0,34–0,92 |
| codebase-memory | 0,64–0,99 | 0,36–0,97 |
| code-review-graph | 0,76–0,99 | 0,03–0,69 |

**Nenhuma ferramenta baseada em tree-sitter é confiável como "lista completa de callers".** Exponha isso ao agente como confiança da aresta e mande ele confirmar com Grep quando importar.

---

## 3. Evidências

### 3.1 Repo map do Aider: o algoritmo exato

Fonte: [`aider/repomap.py`](https://github.com/Aider-AI/aider/blob/main/aider/repomap.py) e as queries em [`aider/queries/`](https://github.com/Aider-AI/aider/tree/main/aider/queries).

**1. Tags.** Um `tags.scm` por linguagem captura `@name.definition.*` e `@name.reference.*`. As queries vêm dos `tags.scm` das gramáticas oficiais, com ajustes. Quando uma linguagem só tem definições, o Aider usa o lexer do Pygments para tirar as referências.

**2. Grafo.** É um `MultiDiGraph` em que **cada nó é um arquivo**. Para cada identificador que é definido e referenciado ao mesmo tempo, cria uma aresta *arquivo que referencia → arquivo que define* com peso `mul × √(nº de refs)`. Uma definição sem referência ganha uma auto-aresta de peso 0,1. O `mul` parte de 1 e vai sendo ajustado:

| Condição | Ajuste |
|---|---|
| identificador mencionado na conversa | ×10 |
| identificador em snake/camel/kebab com 8 ou mais caracteres | ×10 |
| identificador começa com `_` | ×0,1 |
| identificador definido em mais de 5 arquivos (genérico demais) | ×0,1 |
| o arquivo que referencia está no chat | ×50 |

**3. Personalização.** Arquivos do chat e arquivos mencionados recebem `100/N`. Arquivos cujo caminho ou nome casa com um identificador mencionado ganham mais `100/N`. Esse vetor vira `personalization` e `dangling` em `nx.pagerank`.

**4. Rank de símbolo.** O rank de cada arquivo é dividido entre as arestas que saem dele, proporcionalmente ao peso. Assim cada **definição** `(arquivo, ident)` acumula o rank de quem a usa.

**5. Orçamento.** Os símbolos são ordenados por rank e o corte é feito por **busca binária** sobre quantos entram:
- o início é `min(max_tokens/25, n)`;
- a tolerância é 15%;
- a renderização usa `TreeContext`, que mostra a linha da definição com os escopos pais e `⋮` nas omissões, com linhas truncadas em 100 caracteres.

O padrão é `--map-tokens 1024`. Sem arquivos no chat, o orçamento sobe para `min(1024×8, janela−4096)`.

**6. Cache.** As tags ficam em cache por mtime. O mapa é recalculado em modo `auto` só se a última geração levou menos de 1 s.

### 3.2 Papers sobre localização e grafo

| Trabalho | Ideia | Resultado |
|---|---|---|
| **Agentless** ([arXiv 2407.01489](https://arxiv.org/abs/2407.01489)) | localização hierárquica arquivo → classe/função → linha usando o "esqueleto" do repo, sem agente | 32,0% no SWE-bench Lite a ~US$ 0,70 por issue |
| **RepoGraph** ([arXiv 2410.14684](https://arxiv.org/html/2410.14684v2)) | nós = linhas de def/ref (tree-sitter), arestas contain/invoke, ego-grafo de k saltos por termo | SWE-bench Lite: RAG 2,67→5,33%; Agentless 27,33→29,67%; AutoCodeRover 19,00→21,33%; SWE-agent 18,33→20,33%. **Tokens subiram** 5–30% (é contexto *adicional*) |
| **CodexGraph** ([arXiv 2408.03910](https://arxiv.org/abs/2408.03910)) | LLM escreve Cypher sobre o grafo do repo | "competitivo" em CrossCodeEval, SWE-bench e EvoCodeBench. Gerar Cypher é frágil |
| **LocAgent** ([arXiv 2503.09089](https://arxiv.org/html/2503.09089v2)) | grafo heterogêneo dir/arquivo/classe/função com contain/import/invoke/inherit + BM25 sobre IDs. Ferramentas `SearchEntity`, `TraverseGraph`, `RetrieveEntity` | Acc@5 de arquivo **94,16%** contra 79,56% do Agentless e 84,67% do CodeRankEmbed. Acc@10 de função 77,4% contra 58,8%. US$ 0,66 por exemplo com Claude 3.5, US$ 0,05 com Qwen 7B fine-tuned |
| **CoSIL** ([arXiv 2503.22424](https://arxiv.org/html/2503.22424v2)) | call graph construído *durante* a busca, sem indexar antes | Top-1 de 43% no Lite e 44,6% no Verified com Qwen2.5-Coder-32B |
| **KGCompass** ([arXiv 2503.21710](https://papers.cool/arxiv/2503.21710)) | grafo que liga issues, PRs e código | 69,7% das localizações certas exigiram multi-hop |
| **Codebase-Memory** ([arXiv 2603.27277](https://arxiv.org/html/2603.27277v1)) | tree-sitter → SQLite, resolução de chamadas em cascata de 6 estratégias com confiança (import 0,95 → mesmo módulo 0,90 → import por sufixo 0,85 → nome único 0,75 → sufixo 0,55 → fuzzy 0,30–0,40). As 3 primeiras resolvem ~80% | ~1k contra ~10k tokens por pergunta. Perde em "contexto de fonte completo" (16/31 linguagens) e em "grep exaustivo de call sites" (10/31) |
| **Limites de contexto longo** ([arXiv 2602.16069](https://arxiv.org/abs/2602.16069)) | — | trajetórias que deram certo ficaram em **20–30k tokens**. Colocar os arquivos certos num contexto de 64k (recall perfeito) resolveu só 7% |
| **Context Rot** ([Chroma](https://research.trychroma.com/context-rot)) | 18 LLMs | o desempenho cai com o tamanho da entrada, sobretudo com distratores parecidos com o alvo |

**Na indústria:**
- Busca semântica no Cursor: +12,5% de acurácia média (6,5–23,5% conforme o modelo). Ganho maior com mais de 1.000 arquivos ([cursor.com/blog/semsearch](https://cursor.com/blog/semsearch)).
- Talk da turbopuffer na AI Engineer Europe 2026: precisão de arquivo de 65% no Claude Code puro contra 87% com leitura em janelas e busca semântica. Num traço ilustrativo, 6,3k contra ~0,4k tokens ([talk](https://www.ai.engineer/talks/zKk7sDMGDEQ-benchmarking-semantic-code-retrieval-on-claude)).
- A Anthropic recomenda recuperação *just-in-time*: identificadores leves no contexto e carga sob demanda ([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). Boris Cherny relatou que o Claude Code trocou o RAG vetorial pela busca agêntica ([resumo](https://smartscope.blog/en/ai-development/practices/rag-debate-agentic-search-code-exploration/); não encontrei o post original).

**O que concluo das evidências:**

1. Um **mapa compacto e ranqueado no prompt mais ferramentas de navegação** reduz as chamadas e os tokens de exploração. Esse é o ganho mais robusto: 40–90% menos tokens nas perguntas estruturais.
2. **O ganho de qualidade é modesto** (+2 a +15 pontos de localização) e depende do modelo. Com modelos fortes como Opus/Sonnet, o maior ganho é custo e tempo.
3. **Contexto extra pode piorar** (Context Rot; o RepoGraph aumentou os tokens). Por isso o orçamento fixo precisa ser pequeno e o resto sob demanda.
4. O grafo **não substitui ler a fonte.** As ferramentas precisam devolver trechos de código com limite, não só nomes.
5. **Medir na própria Central é obrigatório.** Os números dos fornecedores variam de 2% a 82% por repositório.

---

## 4. Arquitetura recomendada para a Central

### 4.0 O que testei aqui (prova de viabilidade no seu stack)

| Teste | Resultado |
|---|---|
| `web-tree-sitter` 0.27.1 carregando `tree-sitter-typescript.wasm` (ABI 14), `tree-sitter-python.wasm` (ABI 15) e `tree-sitter-terraform.wasm` | OK. As três gramáticas carregaram em **7 ms** |
| `tags.scm` oficial do Python | defs de função/classe/método e refs de chamada OK |
| `tags.scm` do pacote TypeScript **sozinho** | só pega construções específicas de TS (interfaces, tipos). **É preciso concatenar com o `tags.scm` do `tree-sitter-javascript`**, e aí classes, métodos, funções, arrow functions e chamadas saem OK (é o mesmo que o Aider faz) |
| queries próprias de imports TS/Python, `this.http.get(...)` com template string e blocos `resource` do Terraform com `handler`/`route_key` | OK. O código está na seção 4.3 |
| parse + query de **2.000 linhas TS** | **27 ms**, o que dá ~70k linhas/s numa thread. Um projeto de 200k LOC indexa em poucos segundos |
| `node:sqlite` **dentro do Electron 45.2.1** (Node 24.22.1): FTS5 com `tokenize='trigram'` | OK |
| `loadExtension` do `sqlite-vec` 0.1.9 (`vec0.dll`) dentro do Electron 45 com `allowExtension: true`, KNN em `vec0` | OK |
| `graphology-metrics` PageRank | **não tem vetor de personalização**. Escrevi um PPR de ~25 linhas (seção 4.4), verificado com asserts |

### 4.1 Bibliotecas (versões exatas, todas MIT/Apache, sem React)

| Papel | Pacote@versão | Observação |
|---|---|---|
| Parser | `web-tree-sitter@0.27.1` | WASM, sem compilar nativo para o Electron. Importar via `createRequire` (CJS) |
| Gramática TS/TSX | `tree-sitter-typescript@0.23.2` | traz `.wasm` + `queries/tags.scm` |
| Gramática JS (só pela query) | `tree-sitter-javascript@0.25.0` | `queries/tags.scm` para concatenar |
| Gramática Python | `tree-sitter-python@0.25.0` | traz `.wasm` + `tags.scm` |
| Gramática Terraform/HCL | `@tree-sitter-grammars/tree-sitter-hcl@1.2.0` | traz `tree-sitter-terraform.wasm` e `tree-sitter-hcl.wasm`. **Não tem tags.scm**: a query é nossa |
| Banco | `node:sqlite` (embutido) | FTS5 OK. Para o índice, usar **um arquivo separado** (`code-index.sqlite`): é cache reconstruível, enquanto a memória fica no banco principal |
| Ranking | código próprio (PPR) | `graphology-pagerank`/`graphology-metrics` não personalizam |
| Watcher | `fs.watch(dir, { recursive: true })` nativo | recursivo funciona no Windows e no macOS. Reconciliar por mtime+tamanho+hash ao abrir. `@parcel/watcher@2.6.0` só se o nativo der problema |
| Grafo na UI | `sigma@4.0.4`, `graphology@0.26.0`, `graphology-layout-forceatlas2@0.10.1` (tem worker), `graphology-communities-louvain@2.0.2`, `@sigma/edge-curve@3.1.0` (opcional) | WebGL2. O sigma v4 desenha os rótulos em WebGL com SDF |
| Fase 3 (opcional) | `@huggingface/transformers@4.3.2` + `sqlite-vec@0.1.9` | modelo `Xenova/all-MiniLM-L6-v2` (q8, ~23 MB, 384d) para memória e docstrings. Para código, `jinaai/jina-embeddings-v2-base-code` (ONNX quantizado de 162 MB, 768d). Só se a medição pedir |
| Fase 4 (opcional) | `@sourcegraph/scip-typescript@0.6.0`, `@sourcegraph/scip-python@0.6.8` | refs precisas de compilador num reindex noturno. Substituem arestas heurísticas por arestas com confiança 1,0 |

Empacotamento: colocar os `.wasm` e os `.scm` em `asarUnpack` (ou `extraResources`) e rodar o indexador num **`utilityProcess`** do Electron para não travar o main.

### 4.2 Esquema SQLite

Os nós de código são **cache reconstruível** e vivem num arquivo separado. A memória é **dado precioso** e vive no `central.db`. As duas se ligam por **chave estável de texto** (`node_key`), não por id. Assim o reindex não quebra os vínculos.

```sql
-- ===== code-index.sqlite (cache; pode ser apagado e reconstruído) =====
pragma journal_mode = wal;

create table files (
  id          integer primary key,
  project     text not null,            -- projects.slug
  repo        text not null,            -- repos.path
  path        text not null,            -- relativo ao repo, com '/'
  lang        text not null,            -- ts|tsx|py|tf|...
  size        integer not null,
  mtime_ms    integer not null,
  hash        text not null,            -- sha1 do conteúdo (reconcilia mudanças com o app fechado)
  indexed_at  text not null,
  unique (repo, path)
);

create table nodes (
  id         integer primary key,
  key        text not null unique,      -- 'repo-name:src/app/x.service.ts#TemplateService.list'
  file_id    integer references files on delete cascade,   -- null para nós sintéticos (route, project, repo, dir)
  kind       text not null,             -- project|repo|dir|file|class|interface|type|function|method|variable|
                                         -- component|service|route|lambda|tf_resource|tf_module
  name       text not null,             -- 'list'
  qualname   text not null,             -- 'TemplateService.list'
  signature  text,                       -- primeira linha da definição, até 160 caracteres
  doc        text,                       -- 1ª linha do docstring/JSDoc
  line_start integer, line_end integer,
  exported   integer not null default 0,
  rank       real not null default 0,   -- PageRank global (atualizado após o reindex)
  community  integer,                    -- Louvain (para cor/cluster na UI)
  x real, y real                         -- layout guardado (estabilidade visual)
);
create index nodes_by_file on nodes(file_id);
create index nodes_by_name on nodes(name);

-- referências cruas extraídas pelo parser (antes da resolução)
create table refs (
  id        integer primary key,
  file_id   integer not null references files on delete cascade,
  from_node integer references nodes on delete cascade, -- símbolo que contém a ref (ou o nó do arquivo)
  name      text not null,              -- identificador referenciado
  kind      text not null,              -- call|type|import|inherit|http|tf_ref|handler
  detail    text,                        -- origem do import, URL do http, 'GET /templates/{id}'...
  line      integer
);
create index refs_by_name on refs(name);

create table edges (
  src        integer not null references nodes on delete cascade,
  dst        integer not null references nodes on delete cascade,
  kind       text not null,             -- contains|imports|calls|references|extends|implements|injects|
                                         -- http_calls|routes_to|deploys|configures|tests
  weight     real not null default 1,   -- nº de ocorrências
  confidence real not null default 1,   -- cascata de resolução (0,3–1,0)
  primary key (src, dst, kind)
) without rowid;
create index edges_by_dst on edges(dst, kind);

-- busca: nomes divididos em sub-tokens (camelCase/snake_case → 'template service list')
create virtual table nodes_fts using fts5(
  name_tokens, qualname, path, signature, doc,
  content='', tokenize='unicode61 remove_diacritics 2'
);
-- busca por substring de identificador ('plateSer'); trigram OK no Electron 45
create virtual table nodes_tri using fts5(qualname, content='', tokenize='trigram');

-- telemetria do agente: o que cada run/sessão tocou (alimenta a camada "o que o agente consultou")
create table touches (
  run_id   integer,                     -- runs.id ou null
  session  text,                        -- sessions.slug ou null
  node_key text not null,
  how      text not null,               -- read|edit|grep_hit|mcp_symbol|mcp_neighbors|map
  at       text not null
);
create index touches_by_run on touches(run_id);
```

```sql
-- ===== central.db (dado precioso; junto de projects/tasks/decisions) =====
create table facts (
  id             integer primary key autoincrement,
  project_slug   text not null references projects on delete cascade,
  kind           text not null check (kind in ('decision','convention','gotcha','fact','howto','todo')),
  text           text not null,           -- uma afirmação curta, auto-contida (≤ 300 caracteres)
  source_kind    text not null,           -- run|session|manual|commit|claude_auto_memory|decision
  source_ref     text,                    -- run id, sha, caminho do arquivo .md, decisions.id
  author         text not null,           -- 'gustavo' | 'agent:<nome>'
  confidence     real not null default 0.7,
  pinned         integer not null default 0,
  valid_from     text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  invalidated_at text,                    -- bi-temporal "light" (ideia do Graphiti), sem LLM extrator
  superseded_by  integer references facts,
  status         text not null default 'active' check (status in ('proposed','active','retired'))
);
create table fact_links (
  fact_id  integer not null references facts on delete cascade,
  node_key text not null,                 -- 'repo:path' | 'repo:path#Qual.name' | 'route:GET /templates/{id}'
  primary key (fact_id, node_key)
) without rowid;
create virtual table facts_fts using fts5(text, content='facts', content_rowid='id');
```

### 4.3 Extração (por arquivo, no utilityProcess)

1. **Definições e referências:** `tags.scm` oficial. Para TS/TSX, concatenar o do JS com o do TS. A query é compilada uma vez por linguagem e rodada com `query.matches()` para agrupar as capturas por match.
2. **Imports (queries próprias, já testadas):**
   ```scheme
   ; TypeScript
   (import_statement (import_clause (named_imports (import_specifier name: (identifier) @import.name)))
                     source: (string (string_fragment) @import.source))
   (import_statement (import_clause (identifier) @import.default) source: (string (string_fragment) @import.source))
   ; Python
   (import_from_statement module_name: (_) @import.source name: (dotted_name) @import.name)
   (import_from_statement module_name: (_) @import.source name: (aliased_import name: (dotted_name) @import.name))
   (import_statement name: (dotted_name) @import.source)
   ```
3. **Arestas específicas do seu stack** (é aqui que a Central ganha das ferramentas genéricas):
   - **Angular:** os `@Component`/`@Injectable` mudam o `kind` para `component`/`service`. Os tipos dos parâmetros do `constructor(...)` e as chamadas `inject(X)` viram `injects`. O seletor do componente casa com `<app-x>` nos `.html`, por regex simples, e vira `references`.
   - **HTTP:** a query abaixo extrai `this.http.<verbo>(url)`. A URL é normalizada: `${...}` vira `{}`, a base é removida e sobra `/templates/{}`. O resultado vira um nó `route` com a aresta `http_calls`.
     ```scheme
     (call_expression function: (member_expression object: (member_expression property: (property_identifier) @http.obj)
                                                  property: (property_identifier) @http.method)
                      arguments: (arguments . [(string (string_fragment) @http.url) (template_string) @http.url]))
     ```
   - **Terraform:**
     - `resource "aws_apigatewayv2_route"` com `route_key = "GET /templates/{id}"` gera um nó `route` (normalizado para `{}`) e a aresta `routes_to` até a integração/lambda, seguindo a ref em `target`.
     - `aws_lambda_function` com `handler = "app.main.handler"` e `filename`/`source_dir` gera a aresta `deploys` até a função Python `handler` em `app/main.py`.
     - `module "x" { source = "./modules/x" }` vira `imports`.
     - As refs `aws_iam_role.lambda.arn` viram `configures`.
     ```scheme
     (block (identifier) @_t (string_lit (template_literal) @type) (string_lit (template_literal) @name)
       (body (attribute (identifier) @attr (expression) @value))
       (#eq? @_t "resource") (#match? @attr "^(handler|filename|source_dir|route_key|target|function_name)$"))
     ```
   - Com isso o agente pergunta `code_neighbors("route:GET /templates/{}")` e recebe o service Angular, a rota, a lambda e o handler Python numa chamada só.
4. **Testes:** um arquivo `*.spec.ts`/`test_*.py` cujo import aponta para X gera a aresta `tests` até X. Isso alimenta o `code_impact`, que responde "quais testes rodar".

**Resolução** (uma passada SQL por repo depois da extração, em cascata como no Codebase-Memory):

| Ordem | Estratégia | Confiança |
|---|---|---|
| 1 | nome importado no arquivo, resolvendo o caminho (relativo, `tsconfig.paths`, pacote Python pela pasta) | 0,95 |
| 2 | mesmo arquivo | 0,9 |
| 3 | mesma pasta ou módulo | 0,85 |
| 4 | nome único no repo | 0,75 |
| 5 | único no projeto (outro repo) | 0,6 |
| 6 | ambíguo: aresta para até 3 candidatos | 0,3 |

Chamadas a builtins e libs externas (o import não resolve para nenhum arquivo do repo) são descartadas, como no RepoGraph.

### 4.4 Ranking

**PageRank global** (só para `nodes.rank`, usado na UI e como desempate):
- grafo de arquivos com arestas ref → def;
- peso `√(ocorrências) × confiança`;
- multiplicadores do Aider: nome com 8 ou mais caracteres ×10, `_privado` ×0,1, definido em mais de 5 arquivos ×0,1.

**PageRank personalizado por tarefa**, que é o que decide o repo map injetado. As sementes saem da tarefa e do estado do repositório:

| Semente | Peso |
|---|---|
| arquivos e caminhos citados no prompt ou no título da tarefa | 1,0 |
| símbolos citados (cada token CamelCase/snake do prompt casado no `nodes_fts`) | 0,5 |
| arquivos *dirty* do `git status` | 0,5 |
| arquivos dos commits dos últimos 14 dias (a Central já tem a tabela `commits`) | 0,3 |
| arquivos que runs anteriores da mesma tarefa tocaram (`touches`) | 0,3 |

Depois, o rank do arquivo é distribuído entre as definições pelas arestas de entrada (passo 4 do Aider).

```ts
// ponytail: power iteration O(iters·E) em memória; ok até ~1M arestas. Para mais, usar CSR em Float64Array.
export function ppr(n: number, edges: [number, number, number][], seeds: Map<number, number>, alpha = 0.85, iters = 50) {
  const out = new Float64Array(n); for (const [s, , w] of edges) out[s] += w;
  const p = new Float64Array(n); const sum = [...seeds.values()].reduce((a, b) => a + b, 0);
  if (sum > 0) for (const [k, v] of seeds) p[k] = v / sum; else p.fill(1 / n);
  let r = Float64Array.from(p);
  for (let it = 0; it < iters; it++) {
    const next = new Float64Array(n); let dangling = 0, diff = 0;
    for (let i = 0; i < n; i++) if (out[i] === 0) dangling += r[i];
    for (const [s, d, w] of edges) next[d] += alpha * r[s] * w / out[s];
    for (let i = 0; i < n; i++) { next[i] += (1 - alpha + alpha * dangling) * p[i]; diff += Math.abs(next[i] - r[i]); }
    r = next; if (diff < 1e-8) break;
  }
  return r; // self-check: semente no nó 3 com 3→4 faz r[4] > r[2]; soma = 1 (verificado)
}
```

**Renderização com orçamento** (`renderMap(rankedDefs, budgetTokens)`):
- busca binária no número de definições, com tolerância de 15%, como o Aider;
- tokens estimados por `chars/3.5` (código). Não precisa de tokenizer: dá para calibrar uma vez contra o `usage` que o `stream-json` devolve;
- formato por arquivo, ordenado por rank:
  ```
  app-web:src/app/shared/services/template/template.service.ts
  │export class TemplateService {
  │  list(): Promise<Template[]>
  │  save(t: Template): Promise<void>
  ⋮
  ```
- a saída é **determinística** (mesma entrada, mesmo texto), para aproveitar o cache de prompt do Claude Code entre turnos e sessões.

### 4.5 Indexação incremental

```
[app abre] ──► reconcile(projeto): git ls-files -z  (respeita .gitignore)
                 para cada arquivo: (size, mtime) mudou? → sha1 mudou? → reindexa
                 arquivos sumidos → delete cascade
[fs.watch recursive por repo] ─(debounce 1,5 s, agrupa caminhos)─► reindexa os arquivos mudados
[antes de iniciar run/sessão] ──► reconcile rápido só do repo/projeto alvo (stat-diff, ~ms)
[pós-commit detectado pelo pulse/git.ts existente] ──► nada extra (o watcher já cobriu)

reindexa(arquivos):
  BEGIN
    delete from nodes where file_id in (...)          -- cascata leva refs/edges
    parse + extract → insert nodes, refs (+ FTS)
    nomes_afetados = nomes definidos (antes ∪ depois) + nomes referenciados nos arquivos
    re-resolve refs cujo name ∈ nomes_afetados         -- só refs do repo/projeto
  COMMIT
  (debounce 10 s) recalcula rank global + Louvain → avisa a UI
```

- O trabalho roda inteiro no `utilityProcess`, que tem seu próprio `DatabaseSync` em WAL. O main lê pelo mesmo arquivo.
- Arquivos ignorados: o que estiver fora do `git ls-files`, além de `*.min.js`, arquivos com mais de 1 MB, `node_modules`, `dist`, `.terraform` e `cdk.out`.
- Na primeira indexação, mostrar o progresso na tela do projeto.

### 4.6 Ferramentas MCP

Adicionar ao `app/electron/mcp.ts`, reutilizando o helper `tool(name, desc, zodShape, fn)` que já existe.

Todas devolvem **texto compacto** (não JSON verboso) e respeitam um `limit`. A saída padrão fica em ≤ 1,5k tokens por chamada, e todas registram em `touches`.

```ts
tool('code_map', 'Mapa ranqueado do código (arquivos e assinaturas mais relevantes). Use no início para se orientar.', {
  project: z.string(),
  focus: z.array(z.string()).optional().describe('arquivos, símbolos ou termos da tarefa; viram sementes do PageRank'),
  repo: z.string().optional(),
  budget: z.number().int().min(256).max(8000).default(2000).describe('tokens'),
}, ...)  // → texto no formato do Aider

tool('code_search', 'Busca símbolos e arquivos por nome ou termo (FTS + trigram), ordenados por relevância e rank.', {
  project: z.string(), query: z.string(),
  kind: z.enum(['any','class','function','method','component','service','route','lambda','tf_resource','file']).default('any'),
  limit: z.number().int().max(50).default(15),
}, ...)  // → linhas "kind  key  path:line  signature"

tool('code_symbol', 'Definição de um símbolo: assinatura, doc, local e (opcional) o código-fonte com limite de linhas.', {
  key: z.string().describe('key do code_search, ou nome simples'),
  source: z.boolean().default(true), max_lines: z.number().int().max(400).default(120),
}, ...)

tool('code_neighbors', 'Quem usa / o que usa um símbolo, rota ou arquivo (calls, imports, injects, http_calls, routes_to, deploys, tests).', {
  key: z.string(), direction: z.enum(['in','out','both']).default('both'),
  kinds: z.array(z.string()).optional(), depth: z.number().int().min(1).max(3).default(1),
  limit: z.number().int().max(100).default(30),
}, ...)  // inclui a confiança da aresta; a descrição avisa: "arestas < 0.8 são heurísticas; confirme com Grep se crítico"

tool('code_impact', 'Raio de impacto de uma mudança: símbolos/arquivos/rotas/testes afetados, ordenados.', {
  project: z.string(),
  keys: z.array(z.string()).optional(),
  git_diff: z.boolean().default(false).describe('usar os arquivos alterados no working tree/branch atual'),
  depth: z.number().int().max(4).default(2),
}, ...)  // → afetados + "testes a rodar"

tool('memory_recall', 'Fatos, decisões e convenções do projeto, opcionalmente ligados a arquivos ou símbolos.', {
  project: z.string(), query: z.string().optional(), keys: z.array(z.string()).optional(),
  limit: z.number().int().max(30).default(10),
}, ...)

tool('memory_remember', 'Registra um fato durável e não óbvio pelo código (decisão, convenção, armadilha). Uma afirmação curta.', {
  project: z.string(), kind: z.enum(['decision','convention','gotcha','fact','howto']),
  text: z.string().max(300), links: z.array(z.string()).optional().describe('node keys relacionados'),
}, ...)  // author/source preenchidos pela Central a partir da run/sessão; agente cria como 'proposed' se confidence baixa

tool('memory_supersede', 'Marca um fato como inválido (com motivo) e opcionalmente registra o substituto.', {
  id: z.number().int(), reason: z.string(), replacement: z.string().max(300).optional(),
}, ...)
```

São 8 ferramentas. O CodeGraph chegou a deixar só **1** ferramenta visível por padrão (`codegraph_explore`) para facilitar a escolha do modelo.

- Se a telemetria mostrar que o agente ignora ou confunde as ferramentas, junte `code_search`, `code_symbol` e `code_neighbors` num `code_explore(query)`.
- Nas runs `scope=repo`, adicione `mcp__central__code_*` e `mcp__central__memory_*` às `--allowedTools`.

### 4.7 Como injetar contexto e quanto orçamento usar

A Central já monta `--append-system-prompt-file` por agente e por sessão (`agentdefs.ts`, `central-agent.ts`, `workspace.ts`). Basta acrescentar duas seções geradas:

```markdown
## Mapa do código (Central · gerado em <commit curto>, <n> arquivos indexados)
<code_map com focus = título+prompt da tarefa, budget conforme tabela>

## Memória do projeto
- [decision #12] Lambdas usam powertools Logger; nada de print. (src: decisão 2026-08-03) → infra:lambda/*
- [gotcha #31] O interceptor de auth do Angular ignora /public/*. → app-web:src/app/core/auth.interceptor.ts
...
Ferramentas: antes de Grep/Glob amplos, use code_search / code_neighbors / code_impact (MCP central).
Registre com memory_remember só fatos duráveis que o código não mostra.
```

| Contexto | Mapa | Memória | Total fixo |
|---|---|---|---|
| Agente Central / conversa sem projeto | 0 | 0 (só o panorama atual) | 0 |
| Agente com projeto (escopo projeto, só leitura) | 1.500 | 400 | **~1,9k** |
| Run de repo com tarefa (foco definido) | 2.000 | 600 | **~2,6k** |
| Sessão interativa aberta pela Central | 1.000 | 400 | **~1,4k** (o resto via ferramenta) |
| `code_map` sob demanda | até 8.000 | — | — |

Por que esses números:
- O Aider usa 1k como padrão e 8k sem arquivos no chat.
- As trajetórias bem-sucedidas ficam em 20–30k tokens ([arXiv 2602.16069](https://arxiv.org/abs/2602.16069)).
- A doc do Claude Code pede CLAUDE.md com menos de 200 linhas.
- Um bloco fixo de ~2k, estável entre turnos, vai para o cache de prompt e custa ~10% depois da primeira leitura. O que a medição tem de mostrar é que esse bloco evita mais do que 2k tokens de Grep/Read.

**Memória que entra no prompt:** os fatos `pinned`, mais os top-K por `bm25(facts_fts)` contra o prompt, mais os fatos cujo `fact_links` toque nos arquivos de maior PPR. Fatos retirados (`invalidated_at`) nunca entram.

**Integração com a auto memory do Claude Code:**
- A Central lê `~/.claude/projects/<proj>/memory/*.md` (o frontmatter tem `type`) e importa como `facts` com `source_kind='claude_auto_memory'`, o que dá visibilidade e vínculo com o grafo.
- Os arquivos dos repositórios do usuário não são alterados: nada de escrever em CLAUDE.md, porque o `--append-system-prompt-file` já resolve.
- A auto memory deliberadamente não guarda arquitetura derivável do código. Por isso é complementar ao grafo, não concorrente.

**Telemetria "o que o agente consultou"** (de graça):
- A Central já recebe `stream-json` das runs.
- Para cada `tool_use` de `Read`/`Edit`/`Write` (o `file_path`), `Grep`/`Glob` (o padrão e os arquivos do resultado) e `mcp__central__code_*`, grave em `touches` com o node key correspondente.
- Isso alimenta a camada visual e as sementes de PPR de runs futuras.

**Medição** (a parte que decide se vale continuar):
- Uma flag por projeto, `context.inject = off|map|map+memory`, e as runs registram a variante.
- Comparar o `cost_usd` (já existe em `runs`), o nº de tool calls e o nº de Reads por run, com mediana por tipo de tarefa.
- Critério: manter se houver ≥ 25% menos tokens ou chamadas sem aumento de runs `failed` ou reabertas.

### 4.8 Fases

| Fase | Entrega | Esforço |
|---|---|---|
| 0 (opcional, 1 semana) | plugar o `codebase-memory-mcp` via `--mcp-config` em 1–2 projetos e medir `cost_usd` e chamadas; serve de linha de base | horas |
| 1 | indexador TS/Python/Terraform (defs, refs, imports), resolução em cascata, PPR, `code_map`, `code_search`, `code_symbol`, injeção do mapa, `touches`, flag de A/B | ~1.200–1.500 LOC |
| 2 | arestas do stack (`http_calls`, `routes_to`, `deploys`, `injects`, `tests`), `code_neighbors`, `code_impact`, memória (`facts` + 3 ferramentas + import da auto memory), tela de grafo v1 | ~1.200 LOC |
| 3 (se a medição pedir) | embeddings locais (transformers.js + sqlite-vec) para memória e docstrings; busca híbrida RRF | ~300 LOC + ~25–160 MB de modelo |
| 4 (se a precisão incomodar) | SCIP noturno (`scip-typescript`, `scip-python`) substituindo as arestas heurísticas | ~300 LOC |

---

## 5. Plano de UX da tela de grafo

**Stack:**
- `sigma@4` com `graphology` num componente Angular standalone (`modules/graph/pages/graph-page/`).
- Criar o renderer dentro de `NgZone.runOutsideAngular`, com `ResizeObserver` e `kill()` no `ngOnDestroy`.
- O layout roda no `graphology-layout-forceatlas2/worker` só quando faltam posições; o resultado vai para `nodes.x/y`, para o mapa mental ficar estável entre aberturas.

**Comparação das bibliotecas:**

| Biblioteca | Desempenho | Licença | Uso no Angular | Veredito |
|---|---|---|---|---|
| **sigma 4.0.4** (+graphology) | WebGL2, rótulos SDF em WebGL, picking na GPU; feito para "milhares de nós e arestas" | MIT | vanilla, sem dependência de framework | **escolha.** Também é a base do GitNexus |
| cosmos.gl `@cosmos.gl/graph` 3.5.1 | layout **e** render na GPU; centenas de milhares a milhões de nós (dado do próprio projeto) | MIT (OpenJS). Cuidado: `@cosmograph/cosmos` é **CC-BY-NC** | vanilla | excesso para 1–20k nós; rótulos e interação mais pobres. Plano B se passar de 50k |
| Cytoscape.js 3.34.4 | canvas; WebGL ainda em *preview* (1,2k nós e 16k arestas: 20 → 100+ FPS) | MIT | vanilla | ótimo para diagramas pequenos com nós compostos. **Usar na vista "trace"** (rota → lambda → handler) com layout hierárquico |
| force-graph 1.52.0 / d3-force | canvas 2D; fica lento a partir de ~5–10k nós (simulação na CPU) | MIT | vanilla | não |
| 3d-force-graph 1.80.1 | three.js | MIT | vanilla | efeito visual bonito, ruim para ler código. Não |

**Interação:**

1. **Nível de detalhe semântico, nunca a "bola de pelos" inteira.**
   - Começa no nível projeto → repositórios → pastas: nós agregados com tamanho = soma do rank e arestas agregadas com espessura = nº de dependências.
   - Clicar numa pasta expande para arquivos; clicar num arquivo, para símbolos.
   - Teto de ~3–5k nós visíveis. O resto fica agregado.
2. **Cor por comunidade (Louvain) ou por repo.** Formas e ícones por `kind`: componente, service, lambda, rota, recurso TF e fato de memória (losango).
3. **Busca:** usar a paleta de comandos que já existe (v0.7.0) com `code_search`. Escolher um resultado centraliza a câmera e entra no **modo foco**:
   - o ego-grafo de 1–2 saltos aceso;
   - o resto esmaecido com os `nodeReducer`/`edgeReducer` do sigma, sem recriar o grafo;
   - filtros por tipo de aresta (calls, imports, http, deploys, tests).
4. **Camadas** (toggles):
   - **Código**, a camada base.
   - **Memória:** fatos como satélites ligados aos nós de `fact_links`; um fato retirado aparece tracejado.
   - **Backlog:** tarefas e decisões ligadas aos arquivos que as runs delas tocaram.
   - **Agente:** escolher uma run ou sessão mostra um mapa de calor dos `touches`, com uma régua de tempo para "replay" da exploração e cores diferentes para leu, editou e consultou via MCP. É a resposta visual a "o que o agente consultou" e ajuda a decidir se o mapa injetado foi útil.
5. **Modo impacto:** botão "o que muda se eu mexer aqui?", ou automático com o diff atual do repo. Pinta o raio de `code_impact` por profundidade e lista os testes afetados.
6. **Vista trace** (Cytoscape, layout dagre/breadthfirst): a partir de uma rota, mostra Angular service → rota → integração → lambda → handler → recursos que ele usa.
7. **Painel lateral do nó:** assinatura, doc, prévia do código (até 40 linhas), fatos ligados, commits recentes que tocaram o arquivo (da tabela `commits`) e as ações:
   - "Abrir no editor";
   - "Perguntar ao agente sobre isto", que abre uma sessão com `focus=[key]`;
   - "Lembrar fato aqui", que cria um `memory_remember` manual já com o link.
8. **Acessibilidade:** a lista textual equivalente (vizinhos em tabela) fica sempre disponível no painel; o canvas não pode ser a única forma de chegar à informação. Também precisa funcionar só com teclado (setas percorrem os vizinhos, Enter foca) e os toggles de camada precisam de rótulos.

---

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| **Arestas erradas ou ausentes.** Tree-sitter não resolve tipos; o benchmark independente mostrou recall de 0,03 a 0,97 | confiança na aresta e aviso na descrição da ferramenta; o agente mantém Grep; SCIP na fase 4 |
| **Contexto extra piorando o resultado** (Context Rot; o RepoGraph *aumentou* os tokens) | orçamento fixo ≤ 2,6k; A/B por projeto com a flag; desligar onde não ganhar |
| **Índice desatualizado** | reconcile antes de cada run/sessão; watcher; o cabeçalho do mapa traz o commit e a data; a ferramenta avisa se o arquivo mudou depois do índice |
| **Memória envenenada**, com fatos errados escritos por agentes ou injeção vinda de conteúdo do repo | proveniência obrigatória (run/sessão/autor); agente grava como `proposed` e só vira `active` com confiança alta ou depois de aprovação na tela de Decisões que já existe; `memory_supersede` em vez de apagar; limite de 300 caracteres; fatos nunca são executados como instrução de ferramenta |
| **Ferramentas demais confundem o modelo** | começar com 5 ferramentas de código e 3 de memória; medir o uso por `touches`/`stream-json`; consolidar em `code_explore` se preciso |
| **Licenças** | evitar copiar código de GitNexus (PolyForm NC), Serena (GPL), Basic Memory (AGPL) e repowise (AGPL); só ideias. Todo o stack recomendado é MIT ou Apache |
| **Bancos de grafo embutidos morrendo** (o Kuzu foi arquivado e virou LadybugDB) | SQLite puro; consultas recursivas com `WITH RECURSIVE` bastam para 1–3 saltos |
| **Empacotamento** de `.wasm`/`.scm` e `vec0.dll` dentro do asar | `asarUnpack`; testar o build de release (o smoke test foi com o `electron.exe` de dev) |
| **`node:sqlite` ainda experimental** (emite ExperimentalWarning) | a Central já depende dele. O índice é reconstruível, então mudanças de API afetam pouco |
| **ABI das gramáticas contra o web-tree-sitter** | versões fixadas (testadas: ABI 14 e 15 com 0.27.1); atualizar gramática e runtime juntos |
| **Projeto grande ou monorepo travando a UI** | indexação no `utilityProcess`; agregação na UI; teto de nós visíveis |
| **Superestimar ganhos** (os números de fornecedor variam de 2% a 82% por repo) | a decisão sai da medição na própria Central (fase 0 e flag de A/B), não deste relatório |

---

## 7. Fontes principais

- Aider: [repo map](https://aider.chat/2023/10/22/repomap.html), [repomap.py](https://github.com/Aider-AI/aider/blob/main/aider/repomap.py), [SWE-bench Lite](https://aider.chat/2024/05/22/swe-bench-lite.html)
- Codebase-Memory: [arXiv 2603.27277](https://arxiv.org/abs/2603.27277), [repo](https://github.com/DeusData/codebase-memory-mcp)
- [CodeGraph](https://github.com/colbymchenry/codegraph), [GitNexus](https://github.com/abhigyanpatwari/GitNexus), [Serena](https://github.com/oraios/serena), [code-graph-rag](https://github.com/vitali87/code-graph-rag), [Codanna](https://docs.rs/crate/codanna/0.4.0), [Blarify](https://github.com/blarApp/blarify), [Potpie](https://github.com/potpie-ai/potpie), [Repomix](https://github.com/yamadashy/repomix), [SCIP](https://github.com/sourcegraph/scip/blob/main/scip.proto)
- Memória: [Graphiti](https://github.com/getzep/graphiti), [Zep paper](https://arxiv.org/abs/2501.13956), [Cognee](https://github.com/topoteretes/cognee), [claude-mem](https://github.com/thedotmack/claude-mem), [Basic Memory](https://github.com/basicmachines-co/basic-memory), [memória do Claude Code](https://code.claude.com/docs/en/memory)
- Papers: [Agentless](https://arxiv.org/abs/2407.01489), [RepoGraph](https://arxiv.org/html/2410.14684v2), [CodexGraph](https://arxiv.org/abs/2408.03910), [LocAgent](https://arxiv.org/html/2503.09089v2), [CoSIL](https://arxiv.org/html/2503.22424v2), [KGCompass](https://papers.cool/arxiv/2503.21710), [Limites de contexto longo](https://arxiv.org/abs/2602.16069), [Context Rot](https://research.trychroma.com/context-rot)
- Indústria: [Cursor semsearch](https://cursor.com/blog/semsearch), [talk turbopuffer AIE 2026](https://www.ai.engineer/talks/zKk7sDMGDEQ-benchmarking-semantic-code-retrieval-on-claude), [Anthropic: context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [comparativo de precisão do repowise](https://repowise.dev/blog/comparisons/best-code-graph-mcp-servers), [comparativo do gortex](https://zzet.org/gortex/local-code-graph-mcp-servers-compared/)
- Visualização: [sigma v4](https://github.com/jacomyal/sigma.js/releases/tag/sigma@4.0.0), [cosmos.gl](https://openjsf.org/blog/introducing-cosmos-gl), [Cytoscape WebGL preview](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)
- Kuzu arquivado: [oneuptime](https://oneuptime.com/blog/post/2026-08-12-kuzu-archived-pin-0-11-3-fork-or-migrate/view)
