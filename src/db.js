// Banco de dados SQLite (node:sqlite, sem dependências externas).
// O arquivo do banco fica em data/delas.db — incluído no .gitignore.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./util');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'delas.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('socia','colaborador')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cnpj TEXT,
  regime TEXT NOT NULL DEFAULT 'Simples Nacional',
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','inativa')),
  responsavel_id INTEGER REFERENCES users(id),
  honorario REAL NOT NULL DEFAULT 0,
  dia_vencimento INTEGER NOT NULL DEFAULT 10,
  contato_nome TEXT, contato_fone TEXT, contato_email TEXT,
  observacoes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  context TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  company_id INTEGER REFERENCES companies(id),
  assignee_id INTEGER REFERENCES users(id),
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta','urgente')),
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);

CREATE TABLE IF NOT EXISTS card_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'liberada' CHECK (visibility IN ('restrita','liberada')),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  edited_by INTEGER NOT NULL REFERENCES users(id),
  edited_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  is_dm INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wa_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id),
  phone TEXT NOT NULL,
  contact_name TEXT,
  assignee_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','resolvida')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  text TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  wa_message_id TEXT,
  delivery TEXT NOT NULL DEFAULT 'registrada',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'geral',
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago')),
  paid_at TEXT,
  recurring INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receivables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  description TEXT NOT NULL DEFAULT 'Honorários',
  competencia TEXT NOT NULL,
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','recebido')),
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS closing_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  step TEXT NOT NULL,
  step_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluido')),
  card_id INTEGER REFERENCES cards(id),
  updated_at TEXT,
  UNIQUE (company_id, competencia, step)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pendencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  origem TEXT,
  responsavel_id INTEGER REFERENCES users(id),
  prioridade TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'aberta',
  due_date TEXT,
  resolved_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documentos_empresa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  prazo TEXT,
  observacoes TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- Seed inicial (roda só uma vez, quando não há usuários) ----
function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;

  const insUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  const senha = hashPassword('mudar123');
  insUser.run('Fernanda', 'fernanda@delas.com.br', senha, 'socia');
  insUser.run('Cinthia', 'cinthia@delas.com.br', senha, 'socia');
  insUser.run('Colaborador 1', 'colab1@delas.com.br', senha, 'colaborador');
  insUser.run('Colaborador 2', 'colab2@delas.com.br', senha, 'colaborador');
  insUser.run('Colaborador 3', 'colab3@delas.com.br', senha, 'colaborador');

  const insBoard = db.prepare('INSERT INTO boards (name, context) VALUES (?, ?)');
  const insCol = db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)');
  const boards = [
    ['Fechamento Mensal', 'fechamento'],
    ['Demandas do Dia a Dia', 'demandas'],
    ['Atendimento ao Cliente', 'atendimento'],
  ];
  for (const [name, ctx] of boards) {
    const { lastInsertRowid: bid } = insBoard.run(name, ctx);
    ['A Fazer', 'Em Andamento', 'Aguardando Cliente', 'Concluído'].forEach((c, i) =>
      insCol.run(bid, c, i)
    );
  }

  const { lastInsertRowid: geral } = db
    .prepare('INSERT INTO channels (name, is_dm) VALUES (?, 0)')
    .run('geral');
  const addMember = db.prepare(
    'INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)'
  );
  for (const u of db.prepare('SELECT id FROM users').all()) addMember.run(geral, u.id);

  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    'closing_steps',
    JSON.stringify([
      'Recebimento de documentos',
      'Lançamentos contábeis',
      'Conciliação bancária',
      'Apuração de impostos (DAS)',
      'Folha de pagamento',
      'Envio de guias ao cliente',
      'Conferência final',
    ])
  );
}
// Migrações incrementais — safe em bancos antigos.
try { db.exec("ALTER TABLE cards ADD COLUMN origem TEXT DEFAULT 'interno'"); } catch {}

seed();

module.exports = db;
