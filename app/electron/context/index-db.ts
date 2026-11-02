/**
 * Índice de código (code-index.sqlite): cache reconstruível, separado do central.db. O indexador (utilityProcess) escreve;
 * o processo principal lê (WAL). Chaves de nó são texto estável ("projeto/repo:caminho#Classe.metodo") para a memória
 * do projeto (central.db) continuar ligada aos nós depois de reindexar.
 */
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA = `
pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists files (
  id         integer primary key,
  project    text not null,
  repo       text not null,          -- nome do repositório
  repo_path  text not null,
  path       text not null,          -- relativo ao repo, com '/'
  lang       text not null,
  size       integer not null,
  mtime_ms   integer not null,
  hash       text not null,
  unique (repo_path, path)
);
create index if not exists files_by_project on files(project);

create table if not exists nodes (
  id         integer primary key,
  project    text not null,
  key        text not null unique,
  file_id    integer references files on delete cascade,
  kind       text not null,          -- file|class|interface|type|enum|function|method|component|service|route|lambda|tf_resource|tf_module|variable
  name       text not null,
  qualname   text not null,
  signature  text,
  doc        text,
  line_start integer,
  line_end   integer,
  exported   integer not null default 0,
  rank       real not null default 0
);
create index if not exists nodes_by_file on nodes(file_id);
create index if not exists nodes_by_name on nodes(project, name);

create table if not exists refs (
  id        integer primary key,
  file_id   integer not null references files on delete cascade,
  from_node integer references nodes on delete cascade,
  name      text not null,
  kind      text not null,          -- call|type|import|inject|http|tf_ref|handler|selector
  detail    text,
  line      integer
);
create index if not exists refs_by_file on refs(file_id);
-- apagar um nó passa pelas referências que saem dele: sem índice, cada exclusão varre a tabela
create index if not exists refs_by_from on refs(from_node);

create table if not exists edges (
  project    text not null,
  src        integer not null references nodes on delete cascade,
  dst        integer not null references nodes on delete cascade,
  kind       text not null,         -- imports|calls|references|injects|http_calls|routes_to|deploys|tests|template
  weight     real not null default 1,
  confidence real not null default 1,
  primary key (src, dst, kind)
) without rowid;
create index if not exists edges_by_dst on edges(dst);
create index if not exists edges_by_project on edges(project);

-- rowid = nodes.id (apagar por id é direto; por chave seria varrer a tabela)
create virtual table if not exists nodes_fts using fts5(key unindexed, project unindexed, words, tokenize = 'unicode61 remove_diacritics 2');

create table if not exists index_state (
  project    text primary key,
  files      integer not null default 0,
  nodes      integer not null default 0,
  edges      integer not null default 0,
  indexed_at text,
  ms         integer,
  error      text,
  version    integer not null default 0
);
`;

export function openIndex(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const cols = db.prepare('pragma table_info(index_state)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'version')) db.exec('alter table index_state add column version integer not null default 0');
  return db;
}

/** "TemplateApiService.listAll" → "template api service list all" (busca por pedaço de identificador). */
export const words = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-./:#{}]+/g, ' ').toLowerCase().trim();
