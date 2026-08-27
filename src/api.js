// API REST do sistema. Todas as rotas ficam sob /api/*.
// Permissões: 'socia' = acesso total; 'colaborador' = sem financeiro,
// sem administração de usuários e sem páginas restritas / fora da carteira.
const crypto = require('node:crypto');
const db = require('./db');
const {
  hashPassword,
  verifyPassword,
  newToken,
  readBody,
  readJson,
  sendJson,
  parseCookies,
  currentCompetencia,
} = require('./util');

const SESSION_DAYS = 14;

// ---------- rate limiting (brute-force no login) ----------
// Map<ip, {count, firstAt}> — apenas em memória; suficiente para 5 usuários.
const loginAttempts = new Map();
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

function checkRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: now });
    return false; // não bloqueado
  }
  rec.count++;
  return rec.count > LOGIN_MAX;
}

function resetRateLimit(ip) {
  loginAttempts.delete(ip);
}

// Limpeza periódica para não acumular IPs antigos.
setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [ip, rec] of loginAttempts) {
    if (rec.firstAt < cutoff) loginAttempts.delete(ip);
  }
}, LOGIN_WINDOW_MS);

// ---------- session cleanup (a cada hora) ----------
setInterval(() => {
  try {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  } catch {}
}, 60 * 60 * 1000);

// ---------- infra: sessão, auditoria, notificações ----------

function getUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`
    )
    .get(token);
  return row || null;
}

function audit(userId, action, entity, entityId, detail) {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, action, entity ?? null, entityId ?? null, detail ?? null);
}

function notify(userId, text, link) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)').run(
    userId,
    text,
    link ?? null
  );
}

function notifyMentions(text, authorId, context, link) {
  const users = db.prepare('SELECT id, name FROM users WHERE active = 1').all();
  const author = users.find((u) => u.id === authorId);
  for (const u of users) {
    if (u.id === authorId) continue;
    const re = new RegExp('@' + u.name.split(' ')[0], 'i');
    if (re.test(text)) {
      notify(u.id, `${author ? author.name : 'Alguém'} mencionou você ${context}`, link);
    }
  }
}

function isSocia(user) {
  return user.role === 'socia';
}

// Carteira do colaborador: empresas sob sua responsabilidade.
function canSeeCompany(user, companyId) {
  if (isSocia(user)) return true;
  if (!companyId) return true;
  const row = db
    .prepare('SELECT 1 FROM companies WHERE id = ? AND responsavel_id = ?')
    .get(companyId, user.id);
  return !!row;
}

function companyPublic(row, user) {
  if (isSocia(user)) return row;
  // Colaborador não vê honorário (dado financeiro do escritório).
  const { honorario, ...rest } = row;
  return rest;
}

// ---------- WhatsApp (Meta Cloud API) ----------

const WA_TOKEN = process.env.WA_TOKEN || '';
const WA_PHONE_ID = process.env.WA_PHONE_ID || '';
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'delas-verify';
const WA_APP_SECRET = process.env.WA_APP_SECRET || '';

async function waSend(phone, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) return { delivery: 'registrada', wa_message_id: null };
  try {
    const resp = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace(/\D/g, ''),
        type: 'text',
        text: { body: text },
      }),
    });
    const data = await resp.json();
    if (resp.ok && data.messages && data.messages[0]) {
      return { delivery: 'enviada', wa_message_id: data.messages[0].id };
    }
    return { delivery: 'erro', wa_message_id: null };
  } catch {
    return { delivery: 'erro', wa_message_id: null };
  }
}

function waIncoming(phone, name, text, waId) {
  let conv = db
    .prepare("SELECT * FROM wa_conversations WHERE phone = ? AND status = 'aberta'")
    .get(phone);
  if (!conv) {
    const company = db
      .prepare("SELECT id FROM companies WHERE replace(contato_fone,' ','') LIKE '%' || ? || '%'")
      .get(phone.slice(-8));
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO wa_conversations (company_id, phone, contact_name) VALUES (?, ?, ?)'
      )
      .run(company ? company.id : null, phone, name || null);
    conv = { id: Number(lastInsertRowid), assignee_id: null };
  }
  db.prepare(
    "INSERT INTO wa_messages (conversation_id, direction, text, wa_message_id, delivery) VALUES (?, 'in', ?, ?, 'recebida')"
  ).run(conv.id, text, waId ?? null);
  db.prepare("UPDATE wa_conversations SET status = 'aberta', updated_at = datetime('now') WHERE id = ?").run(conv.id);
  const targets = conv.assignee_id
    ? [{ id: conv.assignee_id }]
    : db.prepare("SELECT id FROM users WHERE role = 'socia' AND active = 1").all();
  for (const t of targets) {
    notify(t.id, `Nova mensagem de WhatsApp de ${name || phone}`, '#/whatsapp');
  }
}

// ---------- rotas ----------

// Cada rota: [método, regex, handler(req,res,user,params), opções]
const routes = [];
function route(method, pattern, handler, opts = {}) {
  routes.push({ method, pattern, handler, opts });
}

// --- autenticação ---

route('POST', /^\/api\/login$/, async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  if (checkRateLimit(ip)) {
    return sendJson(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos.' });
  }
  const { email, password } = await readJson(req);
  const user = db
    .prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1')
    .get(String(email || '').trim());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return sendJson(res, 401, { error: 'E-mail ou senha inválidos' });
  }
  resetRateLimit(ip);
  const token = newToken();
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).run(token, user.id);
  audit(user.id, 'login', 'user', user.id, null);
  res.setHeader(
    'Set-Cookie',
    `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax`
  );
  sendJson(res, 200, { ok: true, must_change_password: !!user.must_change_password });
}, { public: true });

route('POST', /^\/api\/logout$/, (req, res, user) => {
  const token = parseCookies(req).session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  sendJson(res, 200, { ok: true });
});

route('GET', /^\/api\/me$/, (req, res, user) => {
  sendJson(res, 200, {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    must_change_password: !!user.must_change_password,
  });
});

route('POST', /^\/api\/change-password$/, async (req, res, user) => {
  const { current, next } = await readJson(req);
  if (!verifyPassword(String(current || ''), user.password_hash)) {
    return sendJson(res, 400, { error: 'Senha atual incorreta' });
  }
  if (!next || String(next).length < 8) {
    return sendJson(res, 400, { error: 'Nova senha deve ter pelo menos 8 caracteres' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
    hashPassword(String(next)),
    user.id
  );
  audit(user.id, 'troca_senha', 'user', user.id, null);
  sendJson(res, 200, { ok: true });
});

// --- usuários ---

route('GET', /^\/api\/users$/, (req, res, user) => {
  const rows = db
    .prepare('SELECT id, name, email, role, active FROM users ORDER BY name')
    .all();
  if (!isSocia(user)) {
    return sendJson(res, 200, rows.map(({ id, name, role, active }) => ({ id, name, role, active })));
  }
  sendJson(res, 200, rows);
});

route('POST', /^\/api\/users$/, async (req, res, user) => {
  const { name, email, role, password } = await readJson(req);
  if (!name || !email || !['socia', 'colaborador'].includes(role)) {
    return sendJson(res, 400, { error: 'Dados incompletos' });
  }
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email, hashPassword(password || 'mudar123'), role);
    audit(user.id, 'criar', 'user', Number(lastInsertRowid), name);
    sendJson(res, 200, { id: Number(lastInsertRowid) });
  } catch {
    sendJson(res, 400, { error: 'E-mail já cadastrado' });
  }
}, { socia: true });

route('PUT', /^\/api\/users\/(\d+)$/, async (req, res, user, [id]) => {
  const body = await readJson(req);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return sendJson(res, 404, { error: 'Usuário não encontrado' });
  const name = body.name ?? target.name;
  const role = ['socia', 'colaborador'].includes(body.role) ? body.role : target.role;
  const active = body.active === undefined ? target.active : body.active ? 1 : 0;
  db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(
    name, role, active, id
  );
  if (body.reset_password) {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(
      hashPassword(String(body.reset_password)),
      id
    );
  }
  audit(user.id, 'editar', 'user', Number(id), name);
  sendJson(res, 200, { ok: true });
}, { socia: true });

// --- empresas / clientes ---

route('GET', /^\/api\/companies$/, (req, res, user) => {
  const rows = db
    .prepare(
      `SELECT c.*, u.name AS responsavel_nome FROM companies c
       LEFT JOIN users u ON u.id = c.responsavel_id ORDER BY c.name`
    )
    .all();
  const visible = isSocia(user) ? rows : rows.filter((r) => r.responsavel_id === user.id);
  const others = isSocia(user)
    ? []
    : rows
        .filter((r) => r.responsavel_id !== user.id)
        .map((r) => ({ id: r.id, name: r.name, restricted: true }));
  sendJson(res, 200, [...visible.map((r) => companyPublic(r, user)), ...others]);
});

route('POST', /^\/api\/companies$/, async (req, res, user) => {
  const b = await readJson(req);
  if (!b.name) return sendJson(res, 400, { error: 'Nome é obrigatório' });
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO companies (name, cnpj, regime, status, responsavel_id, honorario, dia_vencimento,
        contato_nome, contato_fone, contato_email, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.name, b.cnpj ?? null, b.regime ?? 'Simples Nacional', b.status ?? 'ativa',
      b.responsavel_id ?? null, Number(b.honorario) || 0, Number(b.dia_vencimento) || 10,
      b.contato_nome ?? null, b.contato_fone ?? null, b.contato_email ?? null, b.observacoes ?? null
    );
  const id = Number(lastInsertRowid);
  db.prepare('INSERT INTO pages (company_id) VALUES (?)').run(id);
  audit(user.id, 'criar', 'company', id, b.name);
  sendJson(res, 200, { id });
}, { socia: true });

route('PUT', /^\/api\/companies\/(\d+)$/, async (req, res, user, [id]) => {
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
  if (!c) return sendJson(res, 404, { error: 'Empresa não encontrada' });
  const b = await readJson(req);
  db.prepare(
    `UPDATE companies SET name = ?, cnpj = ?, regime = ?, status = ?, responsavel_id = ?,
      honorario = ?, dia_vencimento = ?, contato_nome = ?, contato_fone = ?, contato_email = ?, observacoes = ?
     WHERE id = ?`
  ).run(
    b.name ?? c.name, b.cnpj ?? c.cnpj, b.regime ?? c.regime, b.status ?? c.status,
    b.responsavel_id === undefined ? c.responsavel_id : b.responsavel_id,
    b.honorario === undefined ? c.honorario : Number(b.honorario) || 0,
    b.dia_vencimento === undefined ? c.dia_vencimento : Number(b.dia_vencimento) || 10,
    b.contato_nome ?? c.contato_nome, b.contato_fone ?? c.contato_fone,
    b.contato_email ?? c.contato_email, b.observacoes ?? c.observacoes, id
  );
  audit(user.id, 'editar', 'company', Number(id), b.name ?? c.name);
  sendJson(res, 200, { ok: true });
}, { socia: true });

// Importação CSV de empresas
route('GET', /^\/api\/companies\/template$/, (req, res) => {
  const bom = '﻿';
  const header = 'cnpj;nome;regime;honorario;contato_nome;contato_fone;contato_email;observacoes\n';
  const example = '25.388.802/0001-41;EXEMPLO EMPRESA LTDA;Simples Nacional;800;;(31)99999-0000;contato@empresa.com;Cliente antigo\n';
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="modelo-importacao-empresas.csv"',
  });
  res.end(bom + header + example);
});

route('POST', /^\/api\/companies\/import$/, async (req, res, user) => {
  const buf = await readBody(req, 10 * 1024 * 1024);
  const text = buf.toString('utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return sendJson(res, 400, { error: 'Arquivo sem dados. Verifique o modelo.' });

  const raw_header = lines[0];
  const sep = raw_header.includes(';') ? ';' : ',';
  const headers = raw_header.split(sep).map((h) => h.toLowerCase().trim().replace(/^"|"$/g, ''));

  const col = (row, ...names) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0 && row[i] !== undefined) return row[i].trim().replace(/^"|"$/g, '') || null;
    }
    return null;
  };

  const regimeOk = new Set(['MEI', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real']);
  const insCompany = db.prepare(
    `INSERT INTO companies (name, cnpj, regime, status, honorario, contato_nome, contato_fone, contato_email, observacoes)
     VALUES (?, ?, ?, 'ativa', ?, ?, ?, ?, ?)`
  );
  const insPage = db.prepare('INSERT INTO pages (company_id) VALUES (?)');

  let inserted = 0, skipped = 0;
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(sep);
    const nome = col(row, 'nome', 'razao_social', 'razão social', 'empresa', 'name');
    if (!nome) { errors.push(`Linha ${i + 1}: nome vazio`); continue; }

    const cnpj = col(row, 'cnpj') || null;
    if (cnpj) {
      const exists = db.prepare('SELECT id FROM companies WHERE cnpj = ?').get(cnpj);
      if (exists) { skipped++; continue; }
    }

    let regime = col(row, 'regime', 'regime tributário', 'regime tributario') || 'Simples Nacional';
    if (!regimeOk.has(regime)) regime = 'Simples Nacional';

    const honorario = parseFloat((col(row, 'honorario', 'honorário', 'valor') || '0').replace(',', '.')) || 0;
    const { lastInsertRowid } = insCompany.run(
      nome, cnpj, regime, honorario,
      col(row, 'contato_nome', 'contato'), col(row, 'contato_fone', 'fone', 'telefone'),
      col(row, 'contato_email', 'email'), col(row, 'observacoes', 'observações', 'obs')
    );
    insPage.run(Number(lastInsertRowid));
    audit(user.id, 'criar', 'company', Number(lastInsertRowid), nome);
    inserted++;
  }

  sendJson(res, 200, { inserted, skipped, errors });
}, { socia: true });

// --- kanban ---

route('GET', /^\/api\/boards$/, (req, res) => {
  sendJson(res, 200, db.prepare('SELECT * FROM boards ORDER BY id').all());
});

route('POST', /^\/api\/boards$/, async (req, res, user) => {
  const { name, context } = await readJson(req);
  if (!name) return sendJson(res, 400, { error: 'Nome é obrigatório' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO boards (name, context) VALUES (?, ?)')
    .run(name, context ?? null);
  const bid = Number(lastInsertRowid);
  const insCol = db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)');
  ['A Fazer', 'Em Andamento', 'Concluído'].forEach((c, i) => insCol.run(bid, c, i));
  audit(user.id, 'criar', 'board', bid, name);
  sendJson(res, 200, { id: bid });
});

route('GET', /^\/api\/boards\/(\d+)$/, (req, res, user, [id]) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
  if (!board) return sendJson(res, 404, { error: 'Quadro não encontrado' });
  const columns = db
    .prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position, id')
    .all(id);
  const cards = db
    .prepare(
      `SELECT k.*, c.name AS company_name, u.name AS assignee_name,
        (SELECT COUNT(*) FROM card_checklist WHERE card_id = k.id) AS checklist_total,
        (SELECT COUNT(*) FROM card_checklist WHERE card_id = k.id AND done = 1) AS checklist_done,
        (SELECT COUNT(*) FROM comments WHERE card_id = k.id) AS comment_count
       FROM cards k
       LEFT JOIN companies c ON c.id = k.company_id
       LEFT JOIN users u ON u.id = k.assignee_id
       WHERE k.column_id IN (SELECT id FROM columns WHERE board_id = ?)
       ORDER BY k.position, k.id`
    )
    .all(id);
  sendJson(res, 200, { board, columns, cards });
});

route('POST', /^\/api\/columns$/, async (req, res, user) => {
  const { board_id, name } = await readJson(req);
  if (!board_id || !name) return sendJson(res, 400, { error: 'Dados incompletos' });
  const max = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM columns WHERE board_id = ?')
    .get(board_id).m;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)')
    .run(board_id, name, max + 1);
  sendJson(res, 200, { id: Number(lastInsertRowid) });
});

route('PUT', /^\/api\/columns\/(\d+)$/, async (req, res, user, [id]) => {
  const { name } = await readJson(req);
  db.prepare('UPDATE columns SET name = ? WHERE id = ?').run(name, id);
  sendJson(res, 200, { ok: true });
});

route('DELETE', /^\/api\/columns\/(\d+)$/, (req, res, user, [id]) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE column_id = ?').get(id).n;
  if (n > 0) return sendJson(res, 400, { error: 'Mova ou exclua os cartões antes de excluir a coluna' });
  db.prepare('DELETE FROM columns WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true });
});

function createCard(user, b) {
  const max = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM cards WHERE column_id = ?')
    .get(b.column_id).m;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO cards (column_id, title, description, company_id, assignee_id, due_date, priority, position, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.column_id, b.title, b.description ?? null, b.company_id ?? null,
      b.assignee_id ?? null, b.due_date ?? null, b.priority ?? 'normal', max + 1, user.id
    );
  const id = Number(lastInsertRowid);
  if (b.assignee_id && b.assignee_id !== user.id) {
    notify(b.assignee_id, `${user.name} atribuiu a tarefa "${b.title}" a você`, '#/kanban');
  }
  audit(user.id, 'criar', 'card', id, b.title);
  return id;
}

route('POST', /^\/api\/cards$/, async (req, res, user) => {
  const b = await readJson(req);
  if (!b.column_id || !b.title) return sendJson(res, 400, { error: 'Dados incompletos' });
  sendJson(res, 200, { id: createCard(user, b) });
});

route('GET', /^\/api\/cards\/(\d+)$/, (req, res, user, [id]) => {
  const card = db
    .prepare(
      `SELECT k.*, c.name AS company_name, u.name AS assignee_name FROM cards k
       LEFT JOIN companies c ON c.id = k.company_id
       LEFT JOIN users u ON u.id = k.assignee_id WHERE k.id = ?`
    )
    .get(id);
  if (!card) return sendJson(res, 404, { error: 'Cartão não encontrado' });
  card.checklist = db.prepare('SELECT * FROM card_checklist WHERE card_id = ?').all(id);
  card.comments = db
    .prepare(
      `SELECT co.*, u.name AS author_name FROM comments co
       JOIN users u ON u.id = co.author_id WHERE co.card_id = ? ORDER BY co.id`
    )
    .all(id);
  sendJson(res, 200, card);
});

route('PUT', /^\/api\/cards\/(\d+)$/, async (req, res, user, [id]) => {
  const c = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  if (!c) return sendJson(res, 404, { error: 'Cartão não encontrado' });
  const b = await readJson(req);
  const assignee = b.assignee_id === undefined ? c.assignee_id : b.assignee_id;
  const columnId = b.column_id ?? c.column_id;
  let doneAt = c.done_at;
  if (b.column_id && b.column_id !== c.column_id) {
    const colName = db.prepare('SELECT name FROM columns WHERE id = ?').get(b.column_id);
    doneAt = colName && /conclu/i.test(colName.name) ? new Date().toISOString() : null;
  }
  db.prepare(
    `UPDATE cards SET column_id = ?, title = ?, description = ?, company_id = ?, assignee_id = ?,
      due_date = ?, priority = ?, position = ?, done_at = ? WHERE id = ?`
  ).run(
    columnId, b.title ?? c.title, b.description ?? c.description,
    b.company_id === undefined ? c.company_id : b.company_id, assignee,
    b.due_date === undefined ? c.due_date : b.due_date, b.priority ?? c.priority,
    b.position === undefined ? c.position : b.position, doneAt, id
  );
  if (assignee && assignee !== c.assignee_id && assignee !== user.id) {
    notify(assignee, `${user.name} atribuiu a tarefa "${b.title ?? c.title}" a você`, '#/kanban');
  }
  sendJson(res, 200, { ok: true });
});

route('DELETE', /^\/api\/cards\/(\d+)$/, (req, res, user, [id]) => {
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
  audit(user.id, 'excluir', 'card', Number(id), null);
  sendJson(res, 200, { ok: true });
});

route('POST', /^\/api\/cards\/(\d+)\/comments$/, async (req, res, user, [id]) => {
  const { text } = await readJson(req);
  if (!text) return sendJson(res, 400, { error: 'Comentário vazio' });
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  if (!card) return sendJson(res, 404, { error: 'Cartão não encontrado' });
  db.prepare('INSERT INTO comments (card_id, author_id, text) VALUES (?, ?, ?)').run(
    id, user.id, text
  );
  for (const target of new Set([card.assignee_id, card.created_by])) {
    if (target && target !== user.id) {
      notify(target, `${user.name} comentou na tarefa "${card.title}"`, '#/kanban');
    }
  }
  notifyMentions(text, user.id, `na tarefa "${card.title}"`, '#/kanban');
  sendJson(res, 200, { ok: true });
});

route('POST', /^\/api\/cards\/(\d+)\/checklist$/, async (req, res, user, [id]) => {
  const { text } = await readJson(req);
  if (!text) return sendJson(res, 400, { error: 'Item vazio' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO card_checklist (card_id, text) VALUES (?, ?)')
    .run(id, text);
  sendJson(res, 200, { id: Number(lastInsertRowid) });
});

route('PUT', /^\/api\/checklist\/(\d+)$/, async (req, res, user, [id]) => {
  const { done, text } = await readJson(req);
  const item = db.prepare('SELECT * FROM card_checklist WHERE id = ?').get(id);
  if (!item) return sendJson(res, 404, { error: 'Item não encontrado' });
  db.prepare('UPDATE card_checklist SET done = ?, text = ? WHERE id = ?').run(
    done === undefined ? item.done : done ? 1 : 0,
    text ?? item.text,
    id
  );
  sendJson(res, 200, { ok: true });
});

route('DELETE', /^\/api\/checklist\/(\d+)$/, (req, res, user, [id]) => {
  db.prepare('DELETE FROM card_checklist WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true });
});

// --- base de conhecimento (páginas por cliente) ---

function pageAccess(user, companyId) {
  const page = db.prepare('SELECT * FROM pages WHERE company_id = ?').get(companyId);
  if (!page) return { error: 404 };
  if (isSocia(user)) return { page };
  if (page.visibility === 'restrita') return { error: 403 };
  if (!canSeeCompany(user, Number(companyId))) return { error: 403 };
  return { page };
}

route('GET', /^\/api\/pages\/(\d+)$/, (req, res, user, [companyId]) => {
  const { page, error } = pageAccess(user, companyId);
  if (error) return sendJson(res, error, { error: error === 403 ? 'Sem acesso a esta página' : 'Página não encontrada' });
  const editor = page.updated_by
    ? db.prepare('SELECT name FROM users WHERE id = ?').get(page.updated_by)
    : null;
  sendJson(res, 200, { ...page, updated_by_name: editor ? editor.name : null });
});

route('PUT', /^\/api\/pages\/(\d+)$/, async (req, res, user, [companyId]) => {
  const { page, error } = pageAccess(user, companyId);
  if (error) return sendJson(res, error, { error: 'Sem acesso a esta página' });
  const b = await readJson(req);
  const visibility =
    isSocia(user) && ['restrita', 'liberada'].includes(b.visibility)
      ? b.visibility
      : page.visibility;
  const content = b.content ?? page.content;
  if (content !== page.content) {
    db.prepare(
      'INSERT INTO page_versions (page_id, content, edited_by) VALUES (?, ?, ?)'
    ).run(page.id, content, user.id);
  }
  db.prepare(
    "UPDATE pages SET content = ?, visibility = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(content, visibility, user.id, page.id);
  audit(user.id, 'editar', 'page', page.id, `empresa ${companyId}`);
  sendJson(res, 200, { ok: true });
});

route('GET', /^\/api\/pages\/(\d+)\/versions$/, (req, res, user, [companyId]) => {
  const { page, error } = pageAccess(user, companyId);
  if (error) return sendJson(res, error, { error: 'Sem acesso' });
  const rows = db
    .prepare(
      `SELECT v.id, v.edited_at, u.name AS edited_by_name, length(v.content) AS size, v.content
       FROM page_versions v JOIN users u ON u.id = v.edited_by
       WHERE v.page_id = ? ORDER BY v.id DESC LIMIT 30`
    )
    .all(page.id);
  sendJson(res, 200, rows);
});

route('POST', /^\/api\/pages\/(\d+)\/restore$/, async (req, res, user, [companyId]) => {
  const { page, error } = pageAccess(user, companyId);
  if (error) return sendJson(res, error, { error: 'Sem acesso' });
  const { version_id } = await readJson(req);
  if (!version_id) return sendJson(res, 400, { error: 'version_id é obrigatório' });
  const version = db.prepare('SELECT * FROM page_versions WHERE id = ? AND page_id = ?').get(version_id, page.id);
  if (!version) return sendJson(res, 404, { error: 'Versão não encontrada' });
  // Salvar a versão atual antes de sobrescrever.
  db.prepare('INSERT INTO page_versions (page_id, content, edited_by) VALUES (?, ?, ?)').run(page.id, page.content, user.id);
  db.prepare("UPDATE pages SET content = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(version.content, user.id, page.id);
  audit(user.id, 'restaurar_versao', 'page', page.id, `version_id=${version_id}`);
  sendJson(res, 200, { ok: true });
});

route('POST', /^\/api\/pages\/(\d+)\/task$/, async (req, res, user, [companyId]) => {
  const { page, error } = pageAccess(user, companyId);
  if (error) return sendJson(res, error, { error: 'Sem acesso' });
  const b = await readJson(req);
  if (!b.title) return sendJson(res, 400, { error: 'Título é obrigatório' });
  const board = b.board_id
    ? db.prepare('SELECT id FROM boards WHERE id = ?').get(b.board_id)
    : db.prepare("SELECT id FROM boards WHERE context = 'demandas' LIMIT 1").get() ||
      db.prepare('SELECT id FROM boards ORDER BY id LIMIT 1').get();
  if (!board) return sendJson(res, 400, { error: 'Nenhum quadro disponível' });
  const col = db
    .prepare('SELECT id FROM columns WHERE board_id = ? ORDER BY position LIMIT 1')
    .get(board.id);
  const id = createCard(user, {
    column_id: col.id,
    title: b.title,
    description: b.description ?? `Tarefa gerada a partir da página do cliente.`,
    company_id: Number(companyId),
    assignee_id: b.assignee_id ?? null,
    due_date: b.due_date ?? null,
    priority: b.priority ?? 'normal',
  });
  sendJson(res, 200, { id });
});

// --- chat interno ---

route('GET', /^\/api\/channels$/, (req, res, user) => {
  const rows = db
    .prepare(
      `SELECT ch.*, (
         SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = ch.id
       ) AS last_message_at
       FROM channels ch
       JOIN channel_members cm ON cm.channel_id = ch.id AND cm.user_id = ?
       ORDER BY ch.is_dm, ch.name`
    )
    .all(user.id);
  for (const ch of rows) {
    if (ch.is_dm) {
      const other = db
        .prepare(
          `SELECT u.name FROM channel_members cm JOIN users u ON u.id = cm.user_id
           WHERE cm.channel_id = ? AND cm.user_id != ?`
        )
        .get(ch.id, user.id);
      ch.name = other ? other.name : ch.name || 'Conversa';
    }
  }
  sendJson(res, 200, rows);
});

route('POST', /^\/api\/channels$/, async (req, res, user) => {
  const b = await readJson(req);
  if (b.dm_with) {
    const existing = db
      .prepare(
        `SELECT ch.id FROM channels ch
         JOIN channel_members a ON a.channel_id = ch.id AND a.user_id = ?
         JOIN channel_members bm ON bm.channel_id = ch.id AND bm.user_id = ?
         WHERE ch.is_dm = 1`
      )
      .get(user.id, b.dm_with);
    if (existing) return sendJson(res, 200, { id: existing.id });
    const { lastInsertRowid } = db
      .prepare('INSERT INTO channels (name, is_dm) VALUES (NULL, 1)')
      .run();
    const id = Number(lastInsertRowid);
    const add = db.prepare('INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)');
    add.run(id, user.id);
    add.run(id, b.dm_with);
    return sendJson(res, 200, { id });
  }
  if (!b.name) return sendJson(res, 400, { error: 'Nome é obrigatório' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO channels (name, is_dm) VALUES (?, 0)')
    .run(b.name);
  const id = Number(lastInsertRowid);
  const add = db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)');
  add.run(id, user.id);
  for (const uid of b.member_ids || []) add.run(id, uid);
  sendJson(res, 200, { id });
});

function channelMember(user, channelId) {
  return !!db
    .prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?')
    .get(channelId, user.id);
}

route('GET', /^\/api\/channels\/(\d+)\/messages$/, (req, res, user, [id], url) => {
  if (!channelMember(user, id)) return sendJson(res, 403, { error: 'Sem acesso ao canal' });
  const after = Number(url.searchParams.get('after') || 0);
  const rows = db
    .prepare(
      `SELECT m.*, u.name AS author_name FROM messages m
       JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ? AND m.id > ? ORDER BY m.id LIMIT 200`
    )
    .all(id, after);
  sendJson(res, 200, rows);
});

route('POST', /^\/api\/channels\/(\d+)\/messages$/, async (req, res, user, [id]) => {
  if (!channelMember(user, id)) return sendJson(res, 403, { error: 'Sem acesso ao canal' });
  const { text } = await readJson(req);
  if (!text) return sendJson(res, 400, { error: 'Mensagem vazia' });
  db.prepare('INSERT INTO messages (channel_id, author_id, text) VALUES (?, ?, ?)').run(
    id, user.id, text
  );
  notifyMentions(text, user.id, 'no chat', '#/chat');
  sendJson(res, 200, { ok: true });
});

route('GET', /^\/api\/chat\/search$/, (req, res, user, params, url) => {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return sendJson(res, 200, []);
  const rows = db
    .prepare(
      `SELECT m.*, u.name AS author_name, ch.name AS channel_name, ch.is_dm
       FROM messages m
       JOIN users u ON u.id = m.author_id
       JOIN channels ch ON ch.id = m.channel_id
       JOIN channel_members cm ON cm.channel_id = ch.id AND cm.user_id = ?
       WHERE m.text LIKE '%' || ? || '%' ORDER BY m.id DESC LIMIT 50`
    )
    .all(user.id, q);
  sendJson(res, 200, rows);
});

// --- WhatsApp ---

route('GET', /^\/api\/wa\/conversations$/, (req, res, user, params, url) => {
  const companyFilter = url.searchParams.get('company_id');
  const whereClause = companyFilter ? 'WHERE w.company_id = ?' : '';
  const rows = db
    .prepare(
      `SELECT w.*, c.name AS company_name, u.name AS assignee_name,
        (SELECT text FROM wa_messages WHERE conversation_id = w.id ORDER BY id DESC LIMIT 1) AS last_text
       FROM wa_conversations w
       LEFT JOIN companies c ON c.id = w.company_id
       LEFT JOIN users u ON u.id = w.assignee_id
       ${whereClause}
       ORDER BY w.updated_at DESC`
    )
    .all(...(companyFilter ? [companyFilter] : []));
  sendJson(res, 200, rows);
});

route('POST', /^\/api\/wa\/conversations$/, async (req, res, user) => {
  const b = await readJson(req);
  if (!b.phone) return sendJson(res, 400, { error: 'Telefone é obrigatório' });
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO wa_conversations (company_id, phone, contact_name, assignee_id) VALUES (?, ?, ?, ?)'
    )
    .run(b.company_id ?? null, b.phone, b.contact_name ?? null, b.assignee_id ?? user.id);
  sendJson(res, 200, { id: Number(lastInsertRowid) });
});

route('GET', /^\/api\/wa\/conversations\/(\d+)\/messages$/, (req, res, user, [id]) => {
  const rows = db
    .prepare(
      `SELECT m.*, u.name AS author_name FROM wa_messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.conversation_id = ? ORDER BY m.id`
    )
    .all(id);
  sendJson(res, 200, rows);
});

route('POST', /^\/api\/wa\/conversations\/(\d+)\/messages$/, async (req, res, user, [id]) => {
  const conv = db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(id);
  if (!conv) return sendJson(res, 404, { error: 'Conversa não encontrada' });
  const { text } = await readJson(req);
  if (!text) return sendJson(res, 400, { error: 'Mensagem vazia' });
  const result = await waSend(conv.phone, text);
  db.prepare(
    "INSERT INTO wa_messages (conversation_id, direction, text, author_id, wa_message_id, delivery) VALUES (?, 'out', ?, ?, ?, ?)"
  ).run(id, text, user.id, result.wa_message_id, result.delivery);
  db.prepare("UPDATE wa_conversations SET updated_at = datetime('now') WHERE id = ?").run(id);
  audit(user.id, 'whatsapp_envio', 'wa_conversation', Number(id), null);
  sendJson(res, 200, { delivery: result.delivery });
});

route('PUT', /^\/api\/wa\/conversations\/(\d+)$/, async (req, res, user, [id]) => {
  const conv = db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(id);
  if (!conv) return sendJson(res, 404, { error: 'Conversa não encontrada' });
  const b = await readJson(req);
  const assignee = b.assignee_id === undefined ? conv.assignee_id : b.assignee_id;
  db.prepare(
    "UPDATE wa_conversations SET company_id = ?, assignee_id = ?, status = ?, contact_name = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    b.company_id === undefined ? conv.company_id : b.company_id,
    assignee,
    ['aberta', 'resolvida'].includes(b.status) ? b.status : conv.status,
    b.contact_name ?? conv.contact_name,
    id
  );
  if (assignee && assignee !== conv.assignee_id && assignee !== user.id) {
    notify(assignee, `${user.name} atribuiu um atendimento de WhatsApp a você`, '#/whatsapp');
  }
  sendJson(res, 200, { ok: true });
});

route('POST', /^\/api\/wa\/conversations\/(\d+)\/task$/, async (req, res, user, [id]) => {
  const conv = db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(id);
  if (!conv) return sendJson(res, 404, { error: 'Conversa não encontrada' });
  const b = await readJson(req);
  const board =
    db.prepare("SELECT id FROM boards WHERE context = 'atendimento' LIMIT 1").get() ||
    db.prepare('SELECT id FROM boards ORDER BY id LIMIT 1').get();
  const col = db
    .prepare('SELECT id FROM columns WHERE board_id = ? ORDER BY position LIMIT 1')
    .get(board.id);
  const cardId = createCard(user, {
    column_id: col.id,
    title: b.title || `Atendimento WhatsApp — ${conv.contact_name || conv.phone}`,
    description: b.description ?? 'Tarefa gerada a partir de atendimento no WhatsApp.',
    company_id: conv.company_id,
    assignee_id: b.assignee_id ?? conv.assignee_id,
    due_date: b.due_date ?? null,
    priority: b.priority ?? 'normal',
  });
  sendJson(res, 200, { id: cardId });
});

// Webhook da Meta Cloud API (público — validado por token de verificação).
route('GET', /^\/api\/whatsapp\/webhook$/, (req, res, user, params, url) => {
  if (
    url.searchParams.get('hub.mode') === 'subscribe' &&
    url.searchParams.get('hub.verify_token') === WA_VERIFY_TOKEN
  ) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(url.searchParams.get('hub.challenge') || '');
  }
  sendJson(res, 403, { error: 'Token de verificação inválido' });
}, { public: true });

route('POST', /^\/api\/whatsapp\/webhook$/, async (req, res) => {
  try {
    // Validar assinatura HMAC-SHA256 da Meta (quando WA_APP_SECRET configurado).
    if (WA_APP_SECRET) {
      const rawBody = await readBody(req);
      const sig = req.headers['x-hub-signature-256'] || '';
      const expected = 'sha256=' + crypto
        .createHmac('sha256', WA_APP_SECRET)
        .update(rawBody)
        .digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return sendJson(res, 403, { error: 'Assinatura inválida' });
      }
      processWebhookBody(JSON.parse(rawBody.toString('utf8') || '{}'));
    } else {
      const body = await readJson(req);
      processWebhookBody(body);
    }
  } catch {
    // Webhook deve sempre responder 200 para a Meta não reenviar em loop.
  }
  sendJson(res, 200, { ok: true });
}, { public: true });

function processWebhookBody(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];

      // Processar atualizações de status de entrega (delivered, read, failed).
      for (const status of value.statuses || []) {
        const waId = status.id;
        const delivery = { delivered: 'entregue', read: 'lida', failed: 'erro' }[status.status] || status.status;
        if (waId) {
          db.prepare(
            "UPDATE wa_messages SET delivery = ? WHERE wa_message_id = ? AND direction = 'out'"
          ).run(delivery, waId);
        }
      }

      // Processar mensagens recebidas (texto e outros tipos).
      for (const msg of value.messages || []) {
        const contact = contacts.find((c) => c.wa_id === msg.from);
        const contactName = contact && contact.profile ? contact.profile.name : null;
        let text;
        if (msg.type === 'text') {
          text = msg.text.body;
        } else {
          // Registrar mensagens não-texto em vez de descartar.
          const labels = {
            image: 'imagem', audio: 'áudio', video: 'vídeo',
            document: 'documento', sticker: 'figurinha', location: 'localização',
          };
          text = `[mensagem de ${labels[msg.type] || msg.type} — abrir no WhatsApp]`;
        }
        waIncoming(msg.from, contactName, text, msg.id);
      }
    }
  }
}

// --- financeiro (restrito às sócias) ---

route('GET', /^\/api\/fin\/payables$/, (req, res) => {
  sendJson(res, 200, db.prepare('SELECT * FROM payables ORDER BY due_date DESC').all());
}, { socia: true });

route('POST', /^\/api\/fin\/payables$/, async (req, res, user) => {
  const b = await readJson(req);
  if (!b.description || !b.amount || !b.due_date) {
    return sendJson(res, 400, { error: 'Descrição, valor e vencimento são obrigatórios' });
  }
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO payables (description, category, amount, due_date, recurring) VALUES (?, ?, ?, ?, ?)'
    )
    .run(b.description, b.category || 'geral', Number(b.amount), b.due_date, b.recurring ? 1 : 0);
  audit(user.id, 'criar', 'payable', Number(lastInsertRowid), b.description);
  sendJson(res, 200, { id: Number(lastInsertRowid) });
}, { socia: true });

route('PUT', /^\/api\/fin\/payables\/(\d+)$/, async (req, res, user, [id]) => {
  const p = db.prepare('SELECT * FROM payables WHERE id = ?').get(id);
  if (!p) return sendJson(res, 404, { error: 'Conta não encontrada' });
  const b = await readJson(req);
  const status = ['pendente', 'pago'].includes(b.status) ? b.status : p.status;
  db.prepare(
    'UPDATE payables SET description = ?, category = ?, amount = ?, due_date = ?, status = ?, paid_at = ?, recurring = ? WHERE id = ?'
  ).run(
    b.description ?? p.description, b.category ?? p.category,
    b.amount === undefined ? p.amount : Number(b.amount),
    b.due_date ?? p.due_date, status,
    status === 'pago' ? (p.paid_at || new Date().toISOString().slice(0, 10)) : null,
    b.recurring === undefined ? p.recurring : b.recurring ? 1 : 0, id
  );
  audit(user.id, 'editar', 'payable', Number(id), b.description ?? p.description);
  sendJson(res, 200, { ok: true });
}, { socia: true });

route('DELETE', /^\/api\/fin\/payables\/(\d+)$/, (req, res, user, [id]) => {
  db.prepare('DELETE FROM payables WHERE id = ?').run(id);
  audit(user.id, 'excluir', 'payable', Number(id), null);
  sendJson(res, 200, { ok: true });
}, { socia: true });

route('GET', /^\/api\/fin\/receivables$/, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS company_name FROM receivables r
       JOIN companies c ON c.id = r.company_id ORDER BY r.due_date DESC`
    )
    .all();
  sendJson(res, 200, rows);
}, { socia: true });

route('POST', /^\/api\/fin\/receivables$/, async (req, res, user) => {
  const b = await readJson(req);
  if (!b.company_id || !b.amount || !b.due_date) {
    return sendJson(res, 400, { error: 'Empresa, valor e vencimento são obrigatórios' });
  }
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO receivables (company_id, description, competencia, amount, due_date) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      b.company_id, b.description || 'Honorários',
      b.competencia || currentCompetencia(), Number(b.amount), b.due_date
    );
  audit(user.id, 'criar', 'receivable', Number(lastInsertRowid), null);
  sendJson(res, 200, { id: Number(lastInsertRowid) });
}, { socia: true });

// Gera cobranças de honorários do mês para todas as empresas ativas.
route('POST', /^\/api\/fin\/receivables\/generate$/, async (req, res, user) => {
  const b = await readJson(req);
  const comp = b.competencia || currentCompetencia();
  const companies = db
    .prepare("SELECT * FROM companies WHERE status = 'ativa' AND honorario > 0")
    .all();
  const exists = db.prepare(
    "SELECT 1 FROM receivables WHERE company_id = ? AND competencia = ? AND description = 'Honorários'"
  );
  const ins = db.prepare(
    "INSERT INTO receivables (company_id, description, competencia, amount, due_date) VALUES (?, 'Honorários', ?, ?, ?)"
  );
  let created = 0;
  for (const c of companies) {
    if (exists.get(c.id, comp)) continue;
    const due = `${comp}-${String(Math.min(c.dia_vencimento || 10, 28)).padStart(2, '0')}`;
    ins.run(c.id, comp, c.honorario, due);
    created++;
  }
  audit(user.id, 'gerar_honorarios', 'receivable', null, `${comp}: ${created} cobranças`);
  sendJson(res, 200, { created });
}, { socia: true });

route('PUT', /^\/api\/fin\/receivables\/(\d+)$/, async (req, res, user, [id]) => {
  const r = db.prepare('SELECT * FROM receivables WHERE id = ?').get(id);
  if (!r) return sendJson(res, 404, { error: 'Cobrança não encontrada' });
  const b = await readJson(req);
  const status = ['pendente', 'recebido'].includes(b.status) ? b.status : r.status;
  db.prepare(
    'UPDATE receivables SET amount = ?, due_date = ?, status = ?, received_at = ?, description = ? WHERE id = ?'
  ).run(
    b.amount === undefined ? r.amount : Number(b.amount),
    b.due_date ?? r.due_date, status,
    status === 'recebido' ? (r.received_at || new Date().toISOString().slice(0, 10)) : null,
    b.description ?? r.description, id
  );
  audit(user.id, 'editar', 'receivable', Number(id), null);
  sendJson(res, 200, { ok: true });
}, { socia: true });

route('DELETE', /^\/api\/fin\/receivables\/(\d+)$/, (req, res, user, [id]) => {
  db.prepare('DELETE FROM receivables WHERE id = ?').run(id);
  audit(user.id, 'excluir', 'receivable', Number(id), null);
  sendJson(res, 200, { ok: true });
}, { socia: true });

route('GET', /^\/api\/fin\/summary$/, (req, res, user, params, url) => {
  const months = Math.min(Number(url.searchParams.get('months') || 6), 24);
  const today = new Date().toISOString().slice(0, 10);
  const series = [];
  for (let i = months - 1; i >= 0; i--) {
    const comp = currentCompetencia(-i);
    const rec = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status = 'recebido' THEN amount END), 0) AS recebido,
                COALESCE(SUM(amount), 0) AS previsto,
                COALESCE(SUM(CASE WHEN status = 'pendente' AND due_date < ? THEN amount END), 0) AS inadimplente
         FROM receivables WHERE substr(due_date, 1, 7) = ?`
      )
      .get(today, comp);
    const pag = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status = 'pago' THEN amount END), 0) AS pago,
                COALESCE(SUM(amount), 0) AS previsto
         FROM payables WHERE substr(due_date, 1, 7) = ?`
      )
      .get(comp);
    series.push({
      competencia: comp,
      receita_prevista: rec.previsto,
      receita_recebida: rec.recebido,
      inadimplencia: rec.inadimplente,
      despesa_prevista: pag.previsto,
      despesa_paga: pag.pago,
      saldo_projetado: rec.previsto - pag.previsto,
      saldo_realizado: rec.recebido - pag.pago,
    });
  }
  const inadimplentes = db
    .prepare(
      `SELECT c.name AS company_name, r.competencia, r.amount, r.due_date
       FROM receivables r JOIN companies c ON c.id = r.company_id
       WHERE r.status = 'pendente' AND r.due_date < ? ORDER BY r.due_date LIMIT 50`
    )
    .all(today);
  sendJson(res, 200, { series, inadimplentes });
}, { socia: true });

route('GET', /^\/api\/fin\/export$/, (req, res, user, params, url) => {
  const type = url.searchParams.get('type') === 'payables' ? 'payables' : 'receivables';
  let rows, header;
  if (type === 'payables') {
    rows = db.prepare('SELECT description, category, amount, due_date, status, paid_at FROM payables ORDER BY due_date').all();
    header = ['descricao', 'categoria', 'valor', 'vencimento', 'status', 'pago_em'];
  } else {
    rows = db
      .prepare(
        `SELECT c.name AS empresa, r.description, r.competencia, r.amount, r.due_date, r.status, r.received_at
         FROM receivables r JOIN companies c ON c.id = r.company_id ORDER BY r.due_date`
      )
      .all();
    header = ['empresa', 'descricao', 'competencia', 'valor', 'vencimento', 'status', 'recebido_em'];
  }
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv =
    header.join(';') +
    '\n' +
    rows.map((r) => Object.values(r).map(esc).join(';')).join('\n');
  audit(user.id, 'exportar', type, null, null);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${type}.csv"`,
  });
  res.end('﻿' + csv);
}, { socia: true });

// --- fechamento mensal ---

function closingStepsList() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'closing_steps'").get();
  return row ? JSON.parse(row.value) : [];
}

route('GET', /^\/api\/closing\/settings$/, (req, res) => {
  sendJson(res, 200, { steps: closingStepsList() });
}, { socia: true });

route('PUT', /^\/api\/closing\/settings$/, async (req, res, user) => {
  const { steps } = await readJson(req);
  if (!Array.isArray(steps) || steps.some((s) => typeof s !== 'string' || !s.trim())) {
    return sendJson(res, 400, { error: 'steps deve ser uma lista de strings não-vazias' });
  }
  const cleaned = steps.map((s) => s.trim()).filter(Boolean);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('closing_steps', ?)").run(
    JSON.stringify(cleaned)
  );
  audit(user.id, 'editar', 'closing_settings', null, `${cleaned.length} etapas`);
  sendJson(res, 200, { ok: true, steps: cleaned });
}, { socia: true });

route('GET', /^\/api\/closing$/, (req, res, user, params, url) => {
  const comp = url.searchParams.get('competencia') || currentCompetencia();
  const companies = db
    .prepare(
      `SELECT c.id, c.name, c.responsavel_id, u.name AS responsavel_nome
       FROM companies c LEFT JOIN users u ON u.id = c.responsavel_id
       WHERE c.status = 'ativa' ORDER BY c.name`
    )
    .all();
  const steps = db
    .prepare('SELECT * FROM closing_steps WHERE competencia = ?')
    .all(comp);
  sendJson(res, 200, { competencia: comp, steps_list: closingStepsList(), companies, steps });
});

route('POST', /^\/api\/closing\/init$/, async (req, res, user) => {
  const b = await readJson(req);
  const comp = b.competencia || currentCompetencia();
  const list = closingStepsList();
  const companies = db.prepare("SELECT id FROM companies WHERE status = 'ativa'").all();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO closing_steps (company_id, competencia, step, step_order) VALUES (?, ?, ?, ?)'
  );
  for (const c of companies) {
    list.forEach((s, i) => ins.run(c.id, comp, s, i));
  }
  audit(user.id, 'abrir_competencia', 'closing', null, comp);
  sendJson(res, 200, { ok: true });
});

route('PUT', /^\/api\/closing\/steps\/(\d+)$/, async (req, res, user, [id]) => {
  const step = db.prepare('SELECT * FROM closing_steps WHERE id = ?').get(id);
  if (!step) return sendJson(res, 404, { error: 'Etapa não encontrada' });
  const { status } = await readJson(req);
  if (!['pendente', 'em_andamento', 'concluido'].includes(status)) {
    return sendJson(res, 400, { error: 'Status inválido' });
  }
  db.prepare("UPDATE closing_steps SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status, id
  );
  sendJson(res, 200, { ok: true });
});

// Transforma uma etapa pendente/atrasada em card no quadro de fechamento.
route('POST', /^\/api\/closing\/steps\/(\d+)\/card$/, async (req, res, user, [id]) => {
  const step = db
    .prepare(
      `SELECT s.*, c.name AS company_name, c.responsavel_id FROM closing_steps s
       JOIN companies c ON c.id = s.company_id WHERE s.id = ?`
    )
    .get(id);
  if (!step) return sendJson(res, 404, { error: 'Etapa não encontrada' });
  if (step.card_id) return sendJson(res, 200, { id: step.card_id, existing: true });
  const board =
    db.prepare("SELECT id FROM boards WHERE context = 'fechamento' LIMIT 1").get() ||
    db.prepare('SELECT id FROM boards ORDER BY id LIMIT 1').get();
  const col = db
    .prepare('SELECT id FROM columns WHERE board_id = ? ORDER BY position LIMIT 1')
    .get(board.id);
  const cardId = createCard(user, {
    column_id: col.id,
    title: `${step.step} — ${step.company_name} (${step.competencia})`,
    description: 'Card gerado a partir do painel de fechamento mensal.',
    company_id: step.company_id,
    assignee_id: step.responsavel_id,
    priority: 'alta',
  });
  db.prepare('UPDATE closing_steps SET card_id = ? WHERE id = ?').run(cardId, id);
  sendJson(res, 200, { id: cardId });
});

// --- notificações ---

route('GET', /^\/api\/notifications$/, (req, res, user) => {
  const rows = db
    .prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50'
    )
    .all(user.id);
  sendJson(res, 200, rows);
});

route('POST', /^\/api\/notifications\/read$/, (req, res, user) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(user.id);
  sendJson(res, 200, { ok: true });
});

// --- auditoria (sócias) ---

route('GET', /^\/api\/audit$/, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS user_name FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`
    )
    .all();
  sendJson(res, 200, rows);
}, { socia: true });

// --- dashboard ---

route('GET', /^\/api\/dashboard$/, (req, res, user) => {
  const today = new Date().toISOString().slice(0, 10);
  const myTasks = db
    .prepare(
      `SELECT k.id, k.title, k.due_date, k.priority, c.name AS company_name, col.name AS column_name
       FROM cards k
       JOIN columns col ON col.id = k.column_id
       LEFT JOIN companies c ON c.id = k.company_id
       WHERE k.assignee_id = ? AND k.done_at IS NULL
       ORDER BY k.due_date IS NULL, k.due_date LIMIT 15`
    )
    .all(user.id);
  const overdue = myTasks.filter((t) => t.due_date && t.due_date < today).length;
  const comp = currentCompetencia();
  const closing = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END) AS done
       FROM closing_steps WHERE competencia = ?`
    )
    .get(comp);
  const waOpen = db
    .prepare("SELECT COUNT(*) AS n FROM wa_conversations WHERE status = 'aberta'")
    .get().n;
  const out = { myTasks, overdue, closing: { ...closing, competencia: comp }, waOpen };
  if (isSocia(user)) {
    const fin = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status = 'pendente' AND due_date < ? THEN amount END), 0) AS inadimplencia,
                COALESCE(SUM(CASE WHEN status = 'pendente' THEN amount END), 0) AS a_receber
         FROM receivables`
      )
      .get(today);
    const pay = db
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) AS a_pagar FROM payables WHERE status = 'pendente'"
      )
      .get();
    out.fin = { ...fin, ...pay };
  }
  sendJson(res, 200, out);
});

// ---------- dispatcher ----------

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://local');
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    let user = null;
    if (!r.opts.public) {
      user = getUser(req);
      if (!user) return sendJson(res, 401, { error: 'Não autenticado' });
      if (r.opts.socia && !isSocia(user)) {
        return sendJson(res, 403, { error: 'Acesso restrito às sócias' });
      }
    }
    try {
      await r.handler(req, res, user, m.slice(1), url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Erro interno' });
    }
    return true;
  }
  sendJson(res, 404, { error: 'Rota não encontrada' });
  return true;
}

module.exports = { handleApi };
