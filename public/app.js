/* Delas Gestão — SPA sem frameworks. Roteamento por hash. */
'use strict';

const $app = document.getElementById('app');
let ME = null;
let USERS = [];
let COMPANIES = [];

/* ---------------- infra ---------------- */

async function api(path, opts = {}) {
  const resp = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (resp.status === 401) {
    ME = null;
    renderLogin();
    throw new Error('não autenticado');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Erro no servidor');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtMoney(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(s) {
  if (!s) return '—';
  const d = s.slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : s;
}
function fmtDateTime(s) {
  if (!s) return '—';
  return `${fmtDate(s)} ${s.slice(11, 16)}`;
}
function today() { return new Date().toISOString().slice(0, 10); }
function compAtual() { return today().slice(0, 7); }

function toast(msg, isError) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    background:${isError ? '#dc2626' : '#1f2430'};color:#fff;padding:10px 18px;border-radius:8px;
    z-index:99;box-shadow:0 5px 20px rgba(0,0,0,.3);font-size:14px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function modal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}

function userName(id) {
  const u = USERS.find((x) => x.id === id);
  return u ? u.name : '—';
}

function selectOptions(list, valueKey, labelKey, selected, emptyLabel) {
  let out = emptyLabel !== undefined ? `<option value="">${esc(emptyLabel)}</option>` : '';
  for (const item of list) {
    const v = item[valueKey];
    out += `<option value="${v}" ${v === selected ? 'selected' : ''}>${esc(item[labelKey])}</option>`;
  }
  return out;
}

/* Markdown simplificado para as páginas de cliente. */
function renderMd(src) {
  const lines = String(src || '').split('\n');
  let html = '', inList = false, inTable = false;
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeAll = () => {
    if (inList) { html += '</ul>'; inList = false; }
    if (inTable) { html += '</table>'; inTable = false; }
  };
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('|')) {
      if (inList) { html += '</ul>'; inList = false; }
      if (!inTable) { html += '<table>'; inTable = true; }
      if (/^\|[\s:-|]+\|$/.test(t)) continue;
      const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split('|');
      html += '<tr>' + cells.map((c) => `<td>${inline(c.trim())}</td>`).join('') + '</tr>';
      continue;
    }
    if (inTable) { html += '</table>'; inTable = false; }
    if (t.startsWith('- ') || t.startsWith('* ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(t.slice(2))}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (t.startsWith('### ')) html += `<h3>${inline(t.slice(4))}</h3>`;
    else if (t.startsWith('## ')) html += `<h2>${inline(t.slice(3))}</h2>`;
    else if (t.startsWith('# ')) html += `<h1>${inline(t.slice(2))}</h1>`;
    else if (t === '') html += '<br>';
    else html += `<p>${inline(t)}</p>`;
  }
  closeAll();
  return html;
}

/* ---------------- shell / navegação ---------------- */

const NAV = [
  ['#/dashboard', '🏠 Início'],
  ['#/kanban', '📋 Kanban'],
  ['#/fechamento', '✅ Fechamento Mensal'],
  ['#/empresas', '🏢 Empresas'],
  ['#/chat', '💬 Chat Interno'],
  ['#/whatsapp', '📱 WhatsApp'],
];
const NAV_SOCIA = [
  ['#/financeiro', '💰 Financeiro'],
  ['#/usuarios', '👥 Usuários'],
  ['#/auditoria', '🔍 Auditoria'],
];

function renderShell(title, contentHtml) {
  const hash = location.hash.split('?')[0] || '#/dashboard';
  const navItems = [...NAV, ...(ME.role === 'socia' ? NAV_SOCIA : [])]
    .map(([h, l]) => `<a class="nav ${hash.startsWith(h) ? 'active' : ''}" href="${h}">${l}</a>`)
    .join('');
  $app.innerHTML = `
  <div class="layout">
    <div class="sidebar" id="sidebar">
      <div class="logo">📒 Delas Gestão</div>
      ${navItems}
      <div class="spacer"></div>
      <div class="userbox">
        <b>${esc(ME.name)}</b>
        ${ME.role === 'socia' ? 'Sócia (admin)' : 'Colaborador(a)'}
        <button onclick="openChangePassword()">Trocar senha</button>
        <button onclick="doLogout()">Sair</button>
      </div>
    </div>
    <div class="main">
      <div class="topbar">
        <button class="hamburger" onclick="toggleSidebar()">☰</button>
        <h1>${esc(title)}</h1>
        <button class="bell" onclick="toggleNotifs()">🔔<span class="dot" id="notif-dot" style="display:none"></span></button>
      </div>
      <div class="content" id="content">${contentHtml}</div>
    </div>
  </div>
  <div id="notif-holder"></div>`;
  refreshNotifDot();
}

window.toggleSidebar = () => {
  const sb = document.getElementById('sidebar');
  const open = sb.classList.toggle('open');
  let overlay = document.getElementById('sb-overlay');
  if (open) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sb-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:39';
      overlay.onclick = () => { sb.classList.remove('open'); overlay.remove(); };
      document.body.appendChild(overlay);
    }
  } else {
    overlay && overlay.remove();
  }
};

window.doLogout = async () => {
  await api('/api/logout', { method: 'POST', body: {} });
  ME = null;
  renderLogin();
};

window.openChangePassword = () => {
  const m = modal(`
    <h2>Trocar senha</h2>
    <div class="field"><label>Senha atual</label><input type="password" id="cp-cur"></div>
    <div class="field"><label>Nova senha (mín. 8 caracteres)</label><input type="password" id="cp-new"></div>
    <div class="error-msg" id="cp-err"></div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="cp-save">Salvar</button>
    </div>`);
  m.querySelector('#cp-save').onclick = async () => {
    try {
      await api('/api/change-password', {
        body: { current: m.querySelector('#cp-cur').value, next: m.querySelector('#cp-new').value },
      });
      m.remove();
      toast('Senha alterada');
    } catch (e) {
      m.querySelector('#cp-err').textContent = e.message;
    }
  };
};

/* ---------------- notificações ---------------- */

let notifOpen = false;
async function refreshNotifDot() {
  try {
    const list = await api('/api/notifications');
    const unread = list.filter((n) => !n.read).length;
    const dot = document.getElementById('notif-dot');
    if (dot) {
      dot.style.display = unread ? '' : 'none';
      dot.textContent = unread;
    }
  } catch {}
}

window.toggleNotifs = async () => {
  const holder = document.getElementById('notif-holder');
  if (notifOpen) { holder.innerHTML = ''; notifOpen = false; return; }
  const list = await api('/api/notifications');
  holder.innerHTML = `<div class="notif-panel">
    ${list.length === 0 ? '<div class="n muted">Nenhuma notificação</div>' : ''}
    ${list.map((n) => `
      <div class="n ${n.read ? '' : 'unread'}" ${n.link ? `style="cursor:pointer" onclick="location.hash='${n.link}';toggleNotifs()"` : ''}>
        ${esc(n.text)}
        <div class="when">${fmtDateTime(n.created_at)}</div>
      </div>`).join('')}
  </div>`;
  notifOpen = true;
  await api('/api/notifications/read', { method: 'POST', body: {} });
  refreshNotifDot();
};

setInterval(() => { if (ME) refreshNotifDot(); }, 30000);

/* ---------------- login ---------------- */

function renderLogin() {
  $app.innerHTML = `
  <div class="login-wrap">
    <div class="login-box">
      <h1>📒 Delas Gestão</h1>
      <p>Sistema interno do escritório</p>
      <div class="field"><label>E-mail</label><input id="lg-email" type="email" autocomplete="username"></div>
      <div class="field"><label>Senha</label><input id="lg-pass" type="password" autocomplete="current-password"></div>
      <div class="error-msg" id="lg-err"></div>
      <button class="btn" id="lg-btn">Entrar</button>
      <p class="muted" style="margin-top:14px">Esqueceu a senha? Peça a uma das sócias para redefinir no módulo Usuários.</p>
    </div>
  </div>`;
  const doLogin = async () => {
    try {
      const r = await api('/api/login', {
        body: {
          email: document.getElementById('lg-email').value,
          password: document.getElementById('lg-pass').value,
        },
      });
      await boot();
      if (r.must_change_password) {
        toast('Por segurança, troque sua senha inicial.');
        openChangePassword();
      }
    } catch (e) {
      document.getElementById('lg-err').textContent = e.message;
    }
  };
  document.getElementById('lg-btn').onclick = doLogin;
  $app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ME) doLogin(); });
}

/* ---------------- dashboard ---------------- */

async function viewDashboard() {
  const d = await api('/api/dashboard');
  const finHtml = d.fin ? `
    <div class="stat"><div class="num">${fmtMoney(d.fin.a_receber)}</div><div class="lbl">A receber (pendente)</div></div>
    <div class="stat"><div class="num" style="color:var(--danger)">${fmtMoney(d.fin.inadimplencia)}</div><div class="lbl">Inadimplência</div></div>
    <div class="stat"><div class="num">${fmtMoney(d.fin.a_pagar)}</div><div class="lbl">A pagar (pendente)</div></div>` : '';
  const pct = d.closing.total ? Math.round((d.closing.done / d.closing.total) * 100) : 0;
  renderShell('Início', `
    <div class="grid4">
      <div class="stat"><div class="num">${d.myTasks.length}</div><div class="lbl">Minhas tarefas abertas</div></div>
      <div class="stat"><div class="num" style="color:${d.overdue ? 'var(--danger)' : 'inherit'}">${d.overdue}</div><div class="lbl">Tarefas atrasadas</div></div>
      <div class="stat"><div class="num">${pct}%</div><div class="lbl">Fechamento ${d.closing.competencia}</div></div>
      <div class="stat"><div class="num">${d.waOpen}</div><div class="lbl">WhatsApp em aberto</div></div>
    </div>
    ${d.fin ? `<h3 style="margin:22px 0 10px">Financeiro (visível só para sócias)</h3><div class="grid3">${finHtml}</div>` : ''}
    <div class="card-panel" style="margin-top:20px">
      <h3 style="margin-top:0">Minhas tarefas</h3>
      ${d.myTasks.length === 0 ? '<p class="muted">Nenhuma tarefa atribuída a você. 🎉</p>' : `
      <table class="list"><thead><tr><th>Tarefa</th><th>Empresa</th><th>Coluna</th><th>Prazo</th><th>Prioridade</th></tr></thead>
      <tbody>${d.myTasks.map((t) => `
        <tr>
          <td>${esc(t.title)}</td>
          <td>${esc(t.company_name || '—')}</td>
          <td>${esc(t.column_name)}</td>
          <td>${t.due_date && t.due_date < today() ? `<span class="badge late">${fmtDate(t.due_date)}</span>` : fmtDate(t.due_date)}</td>
          <td><span class="badge prio-${t.priority}">${t.priority}</span></td>
        </tr>`).join('')}</tbody></table>`}
    </div>`);
}

/* ---------------- kanban ---------------- */

let kanbanFilters = { assignee: '', company: '', priority: '', due: '' };

async function viewKanban() {
  const boards = await api('/api/boards');
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const boardId = Number(params.get('board')) || (boards[0] && boards[0].id);
  if (!boardId) {
    renderShell('Kanban', '<p class="muted">Nenhum quadro. Crie o primeiro.</p><button class="btn" onclick="newBoard()">+ Novo quadro</button>');
    return;
  }
  const data = await api(`/api/boards/${boardId}`);
  const f = kanbanFilters;
  const cards = data.cards.filter((c) =>
    (!f.assignee || c.assignee_id === Number(f.assignee)) &&
    (!f.company || c.company_id === Number(f.company)) &&
    (!f.priority || c.priority === f.priority) &&
    (!f.due || (c.due_date && c.due_date <= f.due))
  );
  const colsHtml = data.columns.map((col) => {
    const colCards = cards.filter((c) => c.column_id === col.id);
    return `
    <div class="kcol" data-col="${col.id}" ondragover="event.preventDefault();this.classList.add('dragover')"
         ondragleave="this.classList.remove('dragover')" ondrop="dropCard(event, ${col.id})">
      <h3>${esc(col.name)} <span class="count">${colCards.length}</span></h3>
      ${colCards.map((c) => `
        <div class="kcard prio-${c.priority}" draggable="true" data-card="${c.id}"
             ondragstart="event.dataTransfer.setData('text/plain','${c.id}');this.classList.add('dragging')"
             ondragend="this.classList.remove('dragging')"
             ondragover="event.preventDefault();event.stopPropagation();this.classList.add('dragover-card')"
             ondragleave="this.classList.remove('dragover-card')"
             ondrop="dropCardBefore(event,${c.id},${col.id})"
             onclick="openCard(${c.id}, ${boardId})">
          <div>${esc(c.title)}</div>
          <div class="meta">
            ${c.company_name ? `<span class="badge">${esc(c.company_name)}</span>` : ''}
            ${c.assignee_name ? `<span>👤 ${esc(c.assignee_name)}</span>` : ''}
            ${c.due_date ? `<span class="${c.due_date < today() && !c.done_at ? 'badge late' : ''}">📅 ${fmtDate(c.due_date)}</span>` : ''}
            ${c.priority !== 'normal' ? `<span class="badge prio-${c.priority}">${c.priority}</span>` : ''}
            ${c.checklist_total ? `<span>☑ ${c.checklist_done}/${c.checklist_total}</span>` : ''}
            ${c.comment_count ? `<span>💬 ${c.comment_count}</span>` : ''}
          </div>
        </div>`).join('')}
      <button class="addcard" onclick="openCardForm(null, ${col.id}, ${boardId})">+ Adicionar cartão</button>
    </div>`;
  }).join('');
  renderShell('Kanban', `
    <div class="toolbar">
      <div><label>Quadro</label>
        <select onchange="location.hash='#/kanban?board='+this.value">
          ${selectOptions(boards, 'id', 'name', boardId)}
        </select></div>
      <div><label>Responsável</label>
        <select onchange="kanbanFilters.assignee=this.value;router()">${selectOptions(USERS.filter((u) => u.active), 'id', 'name', Number(f.assignee) || '', 'Todos')}</select></div>
      <div><label>Empresa</label>
        <select onchange="kanbanFilters.company=this.value;router()">${selectOptions(COMPANIES, 'id', 'name', Number(f.company) || '', 'Todas')}</select></div>
      <div><label>Prioridade</label>
        <select onchange="kanbanFilters.priority=this.value;router()">
          <option value="">Todas</option>
          ${['baixa', 'normal', 'alta', 'urgente'].map((p) => `<option ${f.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select></div>
      <div><label>Prazo até</label><input type="date" value="${f.due}" onchange="kanbanFilters.due=this.value;router()"></div>
      <button class="btn secondary" onclick="newBoard()">+ Quadro</button>
      <button class="btn secondary" onclick="newColumn(${boardId})">+ Coluna</button>
    </div>
    <div class="kanban">${colsHtml}</div>`);
}

window.dropCard = async (ev, colId) => {
  ev.preventDefault();
  ev.currentTarget.classList.remove('dragover');
  const cardId = Number(ev.dataTransfer.getData('text/plain'));
  if (!cardId) return;
  // Drop on column background: move to end of column.
  const col = ev.currentTarget;
  const allIds = [...col.querySelectorAll('.kcard[data-card]')].map((el) => Number(el.dataset.card));
  const without = allIds.filter((id) => id !== cardId);
  without.push(cardId);
  await Promise.all(without.map((id, pos) =>
    api(`/api/cards/${id}`, { method: 'PUT', body: { column_id: colId, position: pos } })
  ));
  router();
};

window.dropCardBefore = async (ev, targetCardId, colId) => {
  ev.preventDefault();
  ev.stopPropagation();
  ev.currentTarget.classList.remove('dragover-card');
  ev.currentTarget.closest('.kcol')?.classList.remove('dragover');
  const cardId = Number(ev.dataTransfer.getData('text/plain'));
  if (!cardId || cardId === targetCardId) return;
  const col = ev.currentTarget.closest('.kcol');
  const allIds = [...col.querySelectorAll('.kcard[data-card]')].map((el) => Number(el.dataset.card));
  const without = allIds.filter((id) => id !== cardId);
  const idx = without.indexOf(targetCardId);
  without.splice(idx, 0, cardId);
  await Promise.all(without.map((id, pos) =>
    api(`/api/cards/${id}`, { method: 'PUT', body: { column_id: colId, position: pos } })
  ));
  router();
};

window.newBoard = () => {
  const m = modal(`
    <h2>Novo quadro</h2>
    <div class="field"><label>Nome</label><input id="nb-name"></div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="nb-save">Criar</button>
    </div>`);
  m.querySelector('#nb-save').onclick = async () => {
    const name = m.querySelector('#nb-name').value.trim();
    if (!name) return;
    const r = await api('/api/boards', { body: { name } });
    m.remove();
    location.hash = `#/kanban?board=${r.id}`;
  };
};

window.newColumn = (boardId) => {
  const name = prompt('Nome da nova coluna:');
  if (!name) return;
  api('/api/columns', { body: { board_id: boardId, name } }).then(router);
};

window.openCardForm = (card, columnId, boardId) => {
  const c = card || {};
  const m = modal(`
    <h2>${card ? 'Editar cartão' : 'Novo cartão'}</h2>
    <div class="field"><label>Título</label><input id="cf-title" value="${esc(c.title || '')}"></div>
    <div class="field"><label>Descrição</label><textarea id="cf-desc" rows="3">${esc(c.description || '')}</textarea></div>
    <div class="grid2">
      <div class="field"><label>Empresa</label><select id="cf-company">${selectOptions(COMPANIES, 'id', 'name', c.company_id || '', '— nenhuma —')}</select></div>
      <div class="field"><label>Responsável</label><select id="cf-assignee">${selectOptions(USERS.filter((u) => u.active), 'id', 'name', c.assignee_id || '', '— ninguém —')}</select></div>
      <div class="field"><label>Prazo</label><input type="date" id="cf-due" value="${c.due_date || ''}"></div>
      <div class="field"><label>Prioridade</label>
        <select id="cf-prio">${['baixa', 'normal', 'alta', 'urgente'].map((p) => `<option ${(c.priority || 'normal') === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    </div>
    <div class="actions">
      ${card ? '<button class="btn danger" id="cf-del" style="margin-right:auto">Excluir</button>' : ''}
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="cf-save">Salvar</button>
    </div>`);
  m.querySelector('#cf-save').onclick = async () => {
    const body = {
      title: m.querySelector('#cf-title').value.trim(),
      description: m.querySelector('#cf-desc').value,
      company_id: Number(m.querySelector('#cf-company').value) || null,
      assignee_id: Number(m.querySelector('#cf-assignee').value) || null,
      due_date: m.querySelector('#cf-due').value || null,
      priority: m.querySelector('#cf-prio').value,
    };
    if (!body.title) return;
    if (card) await api(`/api/cards/${card.id}`, { method: 'PUT', body });
    else await api('/api/cards', { body: { ...body, column_id: columnId } });
    m.remove();
    router();
  };
  const del = m.querySelector('#cf-del');
  if (del) del.onclick = async () => {
    if (!confirm('Excluir este cartão?')) return;
    await api(`/api/cards/${card.id}`, { method: 'DELETE' });
    m.remove();
    router();
  };
};

window.openCard = async (id, boardId) => {
  const c = await api(`/api/cards/${id}`);
  const m = modal(`
    <h2>${esc(c.title)}</h2>
    <p class="muted">
      ${c.company_name ? `🏢 ${esc(c.company_name)} · ` : ''}
      ${c.assignee_name ? `👤 ${esc(c.assignee_name)} · ` : ''}
      📅 ${fmtDate(c.due_date)} · <span class="badge prio-${c.priority}">${c.priority}</span>
    </p>
    ${c.description ? `<p style="white-space:pre-wrap">${esc(c.description)}</p>` : ''}
    <h3 style="font-size:14px">Checklist</h3>
    <div id="ck-list">
      ${c.checklist.map((i) => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
          <input type="checkbox" style="width:auto" ${i.done ? 'checked' : ''} onchange="toggleCk(${i.id}, this.checked, ${id}, ${boardId})">
          <span style="${i.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(i.text)}</span>
          <button class="btn small secondary" style="margin-left:auto" onclick="delCk(${i.id}, ${id}, ${boardId})">✕</button>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin:8px 0 16px">
      <input id="ck-new" placeholder="Novo item do checklist">
      <button class="btn small" id="ck-add">Add</button>
    </div>
    <h3 style="font-size:14px">Comentários</h3>
    <div style="max-height:200px;overflow-y:auto">
      ${c.comments.map((co) => `
        <div style="margin-bottom:8px;font-size:13.5px">
          <b>${esc(co.author_name)}</b> <span class="muted">${fmtDateTime(co.created_at)}</span><br>
          ${esc(co.text)}
        </div>`).join('') || '<p class="muted">Sem comentários.</p>'}
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="cm-new" placeholder="Escreva um comentário… (use @nome para mencionar)">
      <button class="btn small" id="cm-add">Enviar</button>
    </div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Fechar</button>
      <button class="btn" id="cd-edit">Editar cartão</button>
    </div>`);
  m.querySelector('#ck-add').onclick = async () => {
    const text = m.querySelector('#ck-new').value.trim();
    if (!text) return;
    await api(`/api/cards/${id}/checklist`, { body: { text } });
    m.remove(); openCard(id, boardId);
  };
  m.querySelector('#cm-add').onclick = async () => {
    const text = m.querySelector('#cm-new').value.trim();
    if (!text) return;
    await api(`/api/cards/${id}/comments`, { body: { text } });
    m.remove(); openCard(id, boardId);
  };
  m.querySelector('#cd-edit').onclick = () => { m.remove(); openCardForm(c, c.column_id, boardId); };
};

window.toggleCk = async (ckId, done, cardId, boardId) => {
  await api(`/api/checklist/${ckId}`, { method: 'PUT', body: { done } });
};
window.delCk = async (ckId, cardId, boardId) => {
  await api(`/api/checklist/${ckId}`, { method: 'DELETE' });
  document.querySelector('.modal-back').remove();
  openCard(cardId, boardId);
};

/* ---------------- empresas ---------------- */

async function viewEmpresas() {
  COMPANIES = await api('/api/companies');
  const mine = COMPANIES.filter((c) => !c.restricted);
  const isSocia = ME.role === 'socia';
  renderShell('Empresas / Clientes', `
    ${isSocia ? `<div class="toolbar">
      <button class="btn" onclick="companyForm()">+ Nova empresa</button>
      <button class="btn secondary" onclick="importCsvModal()">⬆ Importar CSV</button>
      <a class="btn secondary" href="/api/companies/template" download>⬇ Baixar modelo CSV</a>
    </div>` : ''}
    <div class="card-panel">
      <table class="list">
        <thead><tr><th>Empresa</th><th>Regime</th><th>Responsável</th>${isSocia ? '<th>Honorário</th>' : ''}<th>Status</th><th></th></tr></thead>
        <tbody>
          ${mine.map((c) => `
          <tr>
            <td><b>${esc(c.name)}</b>${c.cnpj ? `<br><span class="muted">${esc(c.cnpj)}</span>` : ''}</td>
            <td>${esc(c.regime)}</td>
            <td>${esc(c.responsavel_nome || '—')}</td>
            ${isSocia ? `<td>${fmtMoney(c.honorario)}</td>` : ''}
            <td><span class="badge ${c.status === 'ativa' ? 'ok' : ''}">${c.status}</span></td>
            <td style="white-space:nowrap">
              <a class="btn small secondary" href="#/pagina?empresa=${c.id}">📄 Página</a>
              ${isSocia ? `<button class="btn small secondary" onclick='companyForm(${JSON.stringify(c).replace(/'/g, '&#39;')})'>Editar</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${!isSocia && COMPANIES.some((c) => c.restricted) ? '<p class="muted" style="margin-top:10px">Empresas fora da sua carteira não são exibidas em detalhe.</p>' : ''}
    </div>`);
}

window.companyForm = (c) => {
  c = c || {};
  const m = modal(`
    <h2>${c.id ? 'Editar empresa' : 'Nova empresa'}</h2>
    <div class="grid2">
      <div class="field"><label>Nome *</label><input id="co-name" value="${esc(c.name || '')}"></div>
      <div class="field"><label>CNPJ</label><input id="co-cnpj" value="${esc(c.cnpj || '')}"></div>
      <div class="field"><label>Regime tributário</label>
        <select id="co-regime">${['Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI'].map((r) => `<option ${(c.regime || 'Simples Nacional') === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field"><label>Status</label>
        <select id="co-status"><option ${c.status !== 'inativa' ? 'selected' : ''}>ativa</option><option ${c.status === 'inativa' ? 'selected' : ''}>inativa</option></select></div>
      <div class="field"><label>Responsável (carteira)</label>
        <select id="co-resp">${selectOptions(USERS.filter((u) => u.active), 'id', 'name', c.responsavel_id || '', '— ninguém —')}</select></div>
      <div class="field"><label>Honorário mensal (R$)</label><input type="number" step="0.01" id="co-hon" value="${c.honorario ?? ''}"></div>
      <div class="field"><label>Dia de vencimento</label><input type="number" min="1" max="28" id="co-venc" value="${c.dia_vencimento ?? 10}"></div>
      <div class="field"><label>Contato — nome</label><input id="co-cnome" value="${esc(c.contato_nome || '')}"></div>
      <div class="field"><label>Contato — WhatsApp/fone</label><input id="co-cfone" value="${esc(c.contato_fone || '')}"></div>
      <div class="field"><label>Contato — e-mail</label><input id="co-cemail" value="${esc(c.contato_email || '')}"></div>
    </div>
    <div class="field"><label>Observações</label><textarea id="co-obs" rows="2">${esc(c.observacoes || '')}</textarea></div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="co-save">Salvar</button>
    </div>`);
  m.querySelector('#co-save').onclick = async () => {
    const body = {
      name: m.querySelector('#co-name').value.trim(),
      cnpj: m.querySelector('#co-cnpj').value.trim() || null,
      regime: m.querySelector('#co-regime').value,
      status: m.querySelector('#co-status').value,
      responsavel_id: Number(m.querySelector('#co-resp').value) || null,
      honorario: Number(m.querySelector('#co-hon').value) || 0,
      dia_vencimento: Number(m.querySelector('#co-venc').value) || 10,
      contato_nome: m.querySelector('#co-cnome').value.trim() || null,
      contato_fone: m.querySelector('#co-cfone').value.trim() || null,
      contato_email: m.querySelector('#co-cemail').value.trim() || null,
      observacoes: m.querySelector('#co-obs').value || null,
    };
    if (!body.name) return;
    if (c.id) await api(`/api/companies/${c.id}`, { method: 'PUT', body });
    else await api('/api/companies', { body });
    m.remove();
    COMPANIES = await api('/api/companies');
    router();
  };
};

window.importCsvModal = () => {
  const m = modal(`
    <h2>Importar empresas via CSV</h2>
    <p class="muted" style="margin-bottom:12px">Selecione um arquivo CSV com as colunas:<br>
    <code>cnpj;nome;regime;honorario;contato_nome;contato_fone;contato_email;observacoes</code><br>
    Separador: ponto e vírgula (;) ou vírgula (,). Empresas com CNPJ já cadastrado são ignoradas.</p>
    <div class="field">
      <label>Arquivo CSV</label>
      <input type="file" id="imp-file" accept=".csv,text/csv,text/plain">
    </div>
    <div id="imp-preview" style="margin-top:8px;font-size:13px;color:#555"></div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="imp-btn" disabled>Importar</button>
    </div>`);

  const fileInput = m.querySelector('#imp-file');
  const preview = m.querySelector('#imp-preview');
  const btn = m.querySelector('#imp-btn');
  let csvText = '';

  fileInput.onchange = () => {
    const f = fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      csvText = e.target.result;
      const lines = csvText.split('\n').filter((l) => l.trim()).length;
      preview.textContent = `Arquivo: ${f.name} — ${lines - 1} linha(s) de dados detectada(s).`;
      btn.disabled = lines < 2;
    };
    reader.readAsText(f, 'UTF-8');
  };

  btn.onclick = async () => {
    if (!csvText) return;
    btn.disabled = true;
    btn.textContent = 'Importando…';
    try {
      const res = await fetch('/api/companies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        body: csvText,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      let msg = `✔ ${data.inserted} empresa(s) importada(s).`;
      if (data.skipped) msg += ` ${data.skipped} ignorada(s) (CNPJ já existe).`;
      if (data.errors?.length) msg += `\nAtenção: ${data.errors.slice(0, 5).join('; ')}`;
      alert(msg);
      m.remove();
      COMPANIES = await api('/api/companies');
      router();
    } catch (err) {
      alert('Erro: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Importar';
    }
  };
};

/* ---------------- página do cliente (base de conhecimento) ---------------- */

const PAGE_TEMPLATE = `# Dados cadastrais
- CNPJ:
- Regime tributário: Simples Nacional
- Anexo do Simples:

# Particularidades fiscais
-

# Estudos tributários realizados
| Data | Estudo | Conclusão |
| ---- | ------ | --------- |

# Decisões e histórico
-

# Contatos-chave
| Nome | Função | Telefone | E-mail |
| ---- | ------ | -------- | ------ |
`;

async function viewPagina() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const companyId = Number(params.get('empresa'));
  const company = COMPANIES.find((c) => c.id === companyId);
  if (!companyId) { location.hash = '#/empresas'; return; }
  let page;
  try {
    page = await api(`/api/pages/${companyId}`);
  } catch (e) {
    renderShell('Página do cliente', `<div class="card-panel"><p>⚠️ ${esc(e.message)}</p><a href="#/empresas">← Voltar</a></div>`);
    return;
  }
  const isSocia = ME.role === 'socia';
  renderShell(`Página — ${company ? company.name : 'Cliente'}`, `
    <div class="toolbar">
      <a class="btn secondary" href="#/empresas">← Empresas</a>
      <button class="btn secondary" onclick="editPage(${companyId})">✏️ Editar</button>
      <button class="btn secondary" onclick="pageVersions(${companyId})">🕓 Versões</button>
      <button class="btn" onclick="pageToTask(${companyId})">➕ Gerar tarefa no kanban</button>
      ${isSocia ? `
        <div><label>Visibilidade</label>
        <select onchange="setPageVisibility(${companyId}, this.value)">
          <option value="liberada" ${page.visibility === 'liberada' ? 'selected' : ''}>Liberada (colaborador responsável)</option>
          <option value="restrita" ${page.visibility === 'restrita' ? 'selected' : ''}>Restrita às sócias</option>
        </select></div>` :
        `<span class="badge ${page.visibility}">${page.visibility}</span>`}
    </div>
    <div class="card-panel page-view">
      ${page.content ? renderMd(page.content) : '<p class="muted">Página vazia. Clique em Editar para começar (um modelo será sugerido).</p>'}
    </div>
    <p class="muted">${page.updated_by_name ? `Última edição por ${esc(page.updated_by_name)} em ${fmtDateTime(page.updated_at)}` : 'Nunca editada'}</p>
    <div id="wa-history-section"></div>`);
  // Carregar histórico de WhatsApp vinculado a esta empresa (assíncrono).
  try {
    const waConvs = await api(`/api/wa/conversations?company_id=${companyId}`);
    const sec = document.getElementById('wa-history-section');
    if (!sec) return;
    if (!waConvs.length) {
      sec.innerHTML = '';
      return;
    }
    sec.innerHTML = `
      <div class="card-panel" style="margin-top:0">
        <h3 style="margin-top:0">📱 Atendimentos via WhatsApp</h3>
        <table class="list">
          <thead><tr><th>Contato</th><th>Responsável</th><th>Status</th><th>Última mensagem</th><th></th></tr></thead>
          <tbody>${waConvs.map((c) => `
            <tr>
              <td>${esc(c.contact_name || c.phone)}</td>
              <td>${esc(c.assignee_name || '—')}</td>
              <td><span class="badge ${c.status === 'resolvida' ? 'ok' : 'warn'}">${c.status}</span></td>
              <td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.last_text || '')}</td>
              <td><a class="btn small secondary" href="#/whatsapp" onclick="waConv=${c.id};setTimeout(router,50)">Abrir</a></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch {}
}

window.setPageVisibility = async (companyId, v) => {
  await api(`/api/pages/${companyId}`, { method: 'PUT', body: { visibility: v } });
  toast('Visibilidade atualizada');
};

window.editPage = async (companyId) => {
  const page = await api(`/api/pages/${companyId}`);
  const m = modal(`
    <h2>Editar página</h2>
    <p class="muted">Formatação: <code># Título</code>, <code>- lista</code>, <code>**negrito**</code>, tabelas com <code>|</code>.</p>
    <div class="page-editor"><textarea id="pg-content">${esc(page.content || PAGE_TEMPLATE)}</textarea></div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="pg-save">Salvar</button>
    </div>`);
  m.querySelector('.modal').style.width = '860px';
  m.querySelector('#pg-save').onclick = async () => {
    await api(`/api/pages/${companyId}`, {
      method: 'PUT',
      body: { content: m.querySelector('#pg-content').value },
    });
    m.remove();
    router();
  };
};

window.pageVersions = async (companyId) => {
  const versions = await api(`/api/pages/${companyId}/versions`);
  const m = modal(`
    <h2>Histórico de versões</h2>
    ${versions.length === 0 ? '<p class="muted">Nenhuma versão registrada ainda.</p>' : `
    <table class="list"><thead><tr><th>Quando</th><th>Quem</th><th>Tamanho</th><th></th></tr></thead>
    <tbody>${versions.map((v) => `
      <tr>
        <td>${fmtDateTime(v.edited_at)}</td>
        <td>${esc(v.edited_by_name)}</td>
        <td>${v.size} car.</td>
        <td><button class="btn small secondary" data-vid="${v.id}">Restaurar</button></td>
      </tr>`).join('')}</tbody></table>`}
    <div class="actions"><button class="btn secondary" onclick="this.closest('.modal-back').remove()">Fechar</button></div>`);
  m.querySelectorAll('[data-vid]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Restaurar esta versão? A versão atual será salva no histórico.')) return;
      await api(`/api/pages/${companyId}/restore`, { body: { version_id: Number(btn.dataset.vid) } });
      m.remove();
      toast('Versão restaurada');
      router();
    };
  });
};

window.pageToTask = (companyId) => {
  const m = modal(`
    <h2>Gerar tarefa no kanban</h2>
    <div class="field"><label>Título *</label><input id="pt-title" placeholder="ex: Aplicar mudança de regime discutida no estudo"></div>
    <div class="grid2">
      <div class="field"><label>Responsável</label><select id="pt-assignee">${selectOptions(USERS.filter((u) => u.active), 'id', 'name', '', '— ninguém —')}</select></div>
      <div class="field"><label>Prazo</label><input type="date" id="pt-due"></div>
    </div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="pt-save">Criar tarefa</button>
    </div>`);
  m.querySelector('#pt-save').onclick = async () => {
    const title = m.querySelector('#pt-title').value.trim();
    if (!title) return;
    await api(`/api/pages/${companyId}/task`, {
      body: {
        title,
        assignee_id: Number(m.querySelector('#pt-assignee').value) || null,
        due_date: m.querySelector('#pt-due').value || null,
      },
    });
    m.remove();
    toast('Tarefa criada no kanban');
  };
};

/* ---------------- fechamento mensal ---------------- */

async function viewFechamento() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const comp = params.get('comp') || compAtual();
  const d = await api(`/api/closing?competencia=${comp}`);
  const stepFor = (companyId, step) =>
    d.steps.find((s) => s.company_id === companyId && s.step === step);
  const hasSteps = d.steps.length > 0;
  renderShell('Fechamento Mensal', `
    <div class="toolbar">
      <div><label>Competência</label><input type="month" value="${comp}" onchange="location.hash='#/fechamento?comp='+this.value"></div>
      ${!hasSteps ? `<button class="btn" onclick="initClosing('${comp}')">Abrir competência ${comp}</button>` : ''}
      ${ME.role === 'socia' ? `<button class="btn secondary" onclick="configClosingSteps()">⚙️ Etapas</button>` : ''}
      <span class="muted">Clique numa etapa para avançar o status. Botão 📋 cria card no kanban.</span>
    </div>
    ${!hasSteps ? '<p class="muted">Competência ainda não aberta.</p>' : `
    <div class="card-panel closing-grid">
      <table>
        <thead><tr><th style="text-align:left">Empresa</th>${d.steps_list.map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead>
        <tbody>
        ${d.companies.map((c) => `
          <tr>
            <td class="company">${esc(c.name)}<br><span class="muted" style="font-weight:400">${esc(c.responsavel_nome || '')}</span></td>
            ${d.steps_list.map((sName) => {
              const s = stepFor(c.id, sName);
              if (!s) return '<td>—</td>';
              const label = { pendente: 'Pendente', em_andamento: 'Em and.', concluido: 'OK ✓' }[s.status];
              return `<td>
                <button class="step-btn step-${s.status}" onclick="cycleStep(${s.id}, '${s.status}')">${label}</button>
                ${s.status !== 'concluido' ? `<button class="btn small secondary" style="margin-top:3px" title="Criar card no kanban" onclick="stepToCard(${s.id})">📋</button>` : ''}
              </td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`}`);
}

window.initClosing = async (comp) => {
  await api('/api/closing/init', { body: { competencia: comp } });
  router();
};
window.cycleStep = async (id, cur) => {
  const next = { pendente: 'em_andamento', em_andamento: 'concluido', concluido: 'pendente' }[cur];
  await api(`/api/closing/steps/${id}`, { method: 'PUT', body: { status: next } });
  router();
};
window.stepToCard = async (id) => {
  const r = await api(`/api/closing/steps/${id}/card`, { method: 'POST', body: {} });
  toast(r.existing ? 'Esta etapa já tem card no kanban' : 'Card criado no kanban');
};

window.configClosingSteps = async () => {
  const { steps } = await api('/api/closing/settings');
  const m = modal(`
    <h2>Etapas do Fechamento</h2>
    <p class="muted" style="margin-bottom:10px">Arraste para reordenar. Mudanças afetam novas competências.</p>
    <div id="cs-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
      ${steps.map((s, i) => `
        <div class="step-item" draggable="true" data-idx="${i}" style="display:flex;align-items:center;gap:8px;background:var(--panel-bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px">
          <span style="cursor:grab;color:var(--muted)">⠿</span>
          <input value="${esc(s)}" style="flex:1;border:none;background:transparent;color:inherit;font-size:14px">
          <button onclick="this.closest('[data-idx]').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px">✕</button>
        </div>`).join('')}
    </div>
    <button class="btn secondary" onclick="addClosingStep()" style="margin-bottom:16px">+ Adicionar etapa</button>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="cs-save">Salvar</button>
    </div>`);
  const list = m.querySelector('#cs-list');
  let dragSrc = null;
  list.addEventListener('dragstart', (e) => {
    dragSrc = e.target.closest('[data-idx]');
    setTimeout(() => dragSrc && dragSrc.classList.add('dragging'), 0);
  });
  list.addEventListener('dragend', () => { dragSrc && dragSrc.classList.remove('dragging'); dragSrc = null; });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('[data-idx]');
    if (!target || !dragSrc || target === dragSrc) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) list.insertBefore(dragSrc, target);
    else list.insertBefore(dragSrc, target.nextSibling);
  });
  window.addClosingStep = () => {
    const div = document.createElement('div');
    div.className = 'step-item';
    div.draggable = true;
    div.dataset.idx = Date.now();
    div.style.cssText = 'display:flex;align-items:center;gap:8px;background:var(--panel-bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px';
    div.innerHTML = `<span style="cursor:grab;color:var(--muted)">⠿</span><input value="" style="flex:1;border:none;background:transparent;color:inherit;font-size:14px"><button onclick="this.closest('[data-idx]').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px">✕</button>`;
    list.appendChild(div);
    div.querySelector('input').focus();
  };
  m.querySelector('#cs-save').onclick = async () => {
    const newSteps = [...list.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    if (!newSteps.length) return toast('Adicione ao menos uma etapa', true);
    await api('/api/closing/settings', { method: 'PUT', body: { steps: newSteps } });
    m.remove();
    toast('Etapas atualizadas');
  };
};

/* ---------------- chat ---------------- */

let chatChannel = null;
let chatTimer = null;
let chatLastId = 0;

async function viewChat() {
  const channels = await api('/api/channels');
  if (!chatChannel && channels.length) chatChannel = channels[0].id;
  renderShell('Chat Interno', `
    <div class="toolbar">
      <button class="btn secondary" onclick="newChannel()">+ Canal</button>
      <button class="btn secondary" onclick="newDm()">+ Conversa direta</button>
      <div style="flex:1"></div>
      <div style="min-width:220px"><input id="chat-q" placeholder="🔎 Buscar no histórico…"
        onkeydown="if(event.key==='Enter')chatSearch(this.value)"></div>
    </div>
    <div class="chat-wrap">
      <div class="chat-list">
        ${channels.map((ch) => `
          <div class="item ${ch.id === chatChannel ? 'active' : ''}" onclick="chatChannel=${ch.id};router()">
            ${ch.is_dm ? '👤' : '#'} ${esc(ch.name || 'geral')}
          </div>`).join('')}
      </div>
      <div class="chat-main">
        <div class="chat-msgs" id="chat-msgs"><p class="muted" style="padding:10px">Carregando…</p></div>
        <div class="chat-input">
          <input id="chat-text" placeholder="Mensagem… (@nome para mencionar)" onkeydown="if(event.key==='Enter')sendChat()">
          <button class="btn" onclick="sendChat()">Enviar</button>
        </div>
      </div>
    </div>`);
  chatLastId = 0;
  await loadChatMsgs(true);
  clearInterval(chatTimer);
  chatTimer = setInterval(() => {
    if (location.hash.startsWith('#/chat') && chatChannel) loadChatMsgs(false);
    else clearInterval(chatTimer);
  }, 5000);
}

function msgHtml(m) {
  return `<div class="msg ${m.author_id === ME.id ? 'mine' : ''}">
    <div class="who">${esc(m.author_name)} · ${fmtDateTime(m.created_at)}</div>
    <div class="bubble">${esc(m.text)}</div>
  </div>`;
}

async function loadChatMsgs(full) {
  if (!chatChannel) return;
  const after = full ? 0 : chatLastId;
  const msgs = await api(`/api/channels/${chatChannel}/messages?after=${after}`);
  const box = document.getElementById('chat-msgs');
  if (!box) return;
  if (!msgs.length && !full) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  if (full) {
    box.innerHTML = msgs.length
      ? msgs.map(msgHtml).join('')
      : '<p class="muted" style="padding:10px">Nenhuma mensagem ainda.</p>';
  } else {
    for (const m of msgs) box.insertAdjacentHTML('beforeend', msgHtml(m));
  }
  if (msgs.length) chatLastId = msgs[msgs.length - 1].id;
  if (atBottom || full) box.scrollTop = box.scrollHeight;
}

window.sendChat = async () => {
  const input = document.getElementById('chat-text');
  const text = input.value.trim();
  if (!text || !chatChannel) return;
  input.value = '';
  await api(`/api/channels/${chatChannel}/messages`, { body: { text } });
  loadChatMsgs(false);
};

window.newChannel = () => {
  const name = prompt('Nome do canal (ex: fiscal, folha):');
  if (!name) return;
  api('/api/channels', {
    body: { name, member_ids: USERS.filter((u) => u.active).map((u) => u.id) },
  }).then((r) => { chatChannel = r.id; router(); });
};

window.newDm = () => {
  const others = USERS.filter((u) => u.active && u.id !== ME.id);
  const m = modal(`
    <h2>Conversa direta</h2>
    <div class="field"><label>Com quem?</label><select id="dm-user">${selectOptions(others, 'id', 'name', '')}</select></div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="dm-go">Abrir</button>
    </div>`);
  m.querySelector('#dm-go').onclick = async () => {
    const r = await api('/api/channels', { body: { dm_with: Number(m.querySelector('#dm-user').value) } });
    m.remove();
    chatChannel = r.id;
    router();
  };
};

window.chatSearch = async (q) => {
  const rows = await api(`/api/chat/search?q=${encodeURIComponent(q)}`);
  modal(`
    <h2>Resultados para "${esc(q)}"</h2>
    ${rows.length === 0 ? '<p class="muted">Nada encontrado.</p>' : rows.map((r) => `
      <div style="margin-bottom:10px;font-size:13.5px">
        <b>${esc(r.author_name)}</b> em ${r.is_dm ? 'conversa direta' : '#' + esc(r.channel_name || '')} · <span class="muted">${fmtDateTime(r.created_at)}</span><br>
        ${esc(r.text)}
      </div>`).join('')}
    <div class="actions"><button class="btn secondary" onclick="this.closest('.modal-back').remove()">Fechar</button></div>`);
};

/* ---------------- whatsapp ---------------- */

let waConv = null;
let waTimer = null;

async function viewWhatsapp() {
  const convs = await api('/api/wa/conversations');
  if (!waConv && convs.length) waConv = convs[0].id;
  const cur = convs.find((c) => c.id === waConv);
  renderShell('Atendimento WhatsApp', `
    <div class="toolbar">
      <button class="btn secondary" onclick="newWaConv()">+ Nova conversa</button>
      <span class="muted">Mensagens dos clientes chegam automaticamente via webhook da API oficial da Meta.</span>
    </div>
    <div class="chat-wrap">
      <div class="chat-list">
        ${convs.length === 0 ? '<div class="item muted">Nenhuma conversa</div>' : ''}
        ${convs.map((c) => `
          <div class="item ${c.id === waConv ? 'active' : ''}" onclick="waConv=${c.id};router()">
            <b>${esc(c.contact_name || c.phone)}</b>
            ${c.status === 'aberta' ? '<span class="badge warn">aberta</span>' : '<span class="badge ok">resolvida</span>'}<br>
            <span class="muted" style="font-size:12px">${esc(c.company_name || 'sem empresa')} · ${esc(c.assignee_name || 'sem responsável')}</span><br>
            <span class="muted" style="font-size:12px">${esc((c.last_text || '').slice(0, 40))}</span>
          </div>`).join('')}
      </div>
      <div class="chat-main">
        ${cur ? `
        <div style="padding:10px 14px;border-bottom:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <b>${esc(cur.contact_name || cur.phone)}</b>
          <select style="width:auto" onchange="waAssign(${cur.id}, this.value)">${selectOptions(USERS.filter((u) => u.active), 'id', 'name', cur.assignee_id || '', 'Atribuir a…')}</select>
          <select style="width:auto" onchange="waCompany(${cur.id}, this.value)">${selectOptions(COMPANIES.filter((c) => !c.restricted), 'id', 'name', cur.company_id || '', 'Vincular empresa…')}</select>
          <button class="btn small secondary" onclick="waTask(${cur.id})">📋 Virar tarefa</button>
          <button class="btn small ${cur.status === 'aberta' ? '' : 'secondary'}" onclick="waStatus(${cur.id}, '${cur.status === 'aberta' ? 'resolvida' : 'aberta'}')">
            ${cur.status === 'aberta' ? '✓ Resolver' : 'Reabrir'}
          </button>
        </div>` : ''}
        <div class="chat-msgs" id="wa-msgs"></div>
        <div class="chat-input">
          <input id="wa-text" placeholder="Responder pelo WhatsApp do escritório…" onkeydown="if(event.key==='Enter')sendWa()">
          <button class="btn" onclick="sendWa()">Enviar</button>
        </div>
      </div>
    </div>`);
  await loadWaMsgs();
  clearInterval(waTimer);
  waTimer = setInterval(() => {
    if (location.hash.startsWith('#/whatsapp') && waConv) loadWaMsgs();
    else clearInterval(waTimer);
  }, 7000);
}

async function loadWaMsgs() {
  if (!waConv) return;
  const msgs = await api(`/api/wa/conversations/${waConv}/messages`);
  const box = document.getElementById('wa-msgs');
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = msgs.map((m) => `
    <div class="msg ${m.direction === 'out' ? 'mine' : ''}">
      <div class="who">${m.direction === 'out' ? esc(m.author_name || 'Escritório') : 'Cliente'} · ${fmtDateTime(m.created_at)}
        ${m.direction === 'out' && m.delivery !== 'enviada' ? `<span class="badge ${m.delivery === 'erro' ? 'late' : ''}">${m.delivery}</span>` : ''}
      </div>
      <div class="bubble">${esc(m.text)}</div>
    </div>`).join('') || '<p class="muted" style="padding:10px">Sem mensagens.</p>';
  if (atBottom) box.scrollTop = box.scrollHeight;
}

window.sendWa = async () => {
  const input = document.getElementById('wa-text');
  const text = input.value.trim();
  if (!text || !waConv) return;
  input.value = '';
  const r = await api(`/api/wa/conversations/${waConv}/messages`, { body: { text } });
  if (r.delivery === 'registrada') toast('Mensagem registrada (API do WhatsApp não configurada — envie manualmente)');
  if (r.delivery === 'erro') toast('Falha ao enviar pelo WhatsApp', true);
  loadWaMsgs();
};

window.waAssign = async (id, v) => { await api(`/api/wa/conversations/${id}`, { method: 'PUT', body: { assignee_id: Number(v) || null } }); router(); };
window.waCompany = async (id, v) => { await api(`/api/wa/conversations/${id}`, { method: 'PUT', body: { company_id: Number(v) || null } }); router(); };
window.waStatus = async (id, s) => { await api(`/api/wa/conversations/${id}`, { method: 'PUT', body: { status: s } }); router(); };
window.waTask = async (id) => {
  await api(`/api/wa/conversations/${id}/task`, { method: 'POST', body: {} });
  toast('Tarefa criada no kanban');
};

window.newWaConv = () => {
  const m = modal(`
    <h2>Nova conversa de WhatsApp</h2>
    <div class="grid2">
      <div class="field"><label>Telefone (com DDD) *</label><input id="wc-phone" placeholder="5511999998888"></div>
      <div class="field"><label>Nome do contato</label><input id="wc-name"></div>
    </div>
    <div class="field"><label>Empresa</label><select id="wc-company">${selectOptions(COMPANIES.filter((c) => !c.restricted), 'id', 'name', '', '— nenhuma —')}</select></div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="wc-save">Criar</button>
    </div>`);
  m.querySelector('#wc-save').onclick = async () => {
    const phone = m.querySelector('#wc-phone').value.trim();
    if (!phone) return;
    const r = await api('/api/wa/conversations', {
      body: {
        phone,
        contact_name: m.querySelector('#wc-name').value.trim() || null,
        company_id: Number(m.querySelector('#wc-company').value) || null,
      },
    });
    m.remove();
    waConv = r.id;
    router();
  };
};

/* ---------------- financeiro (sócias) ---------------- */

async function viewFinanceiro() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const tab = params.get('tab') || 'resumo';
  const tabs = [
    ['resumo', '📊 Resumo'],
    ['receber', '📥 Contas a receber'],
    ['pagar', '📤 Contas a pagar'],
  ];
  const tabBar = `<div class="toolbar">${tabs.map(([t, l]) =>
    `<a class="btn ${tab === t ? '' : 'secondary'}" href="#/financeiro?tab=${t}">${l}</a>`).join('')}
    <div style="flex:1"></div>
    <a class="btn secondary" href="/api/fin/export?type=receivables" target="_blank">⬇ Exportar receber (CSV)</a>
    <a class="btn secondary" href="/api/fin/export?type=payables" target="_blank">⬇ Exportar pagar (CSV)</a>
  </div>`;

  let body = '';
  if (tab === 'resumo') {
    const d = await api('/api/fin/summary?months=6');
    const cur = d.series[d.series.length - 1] || {};
    body = `
      <div class="grid4">
        <div class="stat"><div class="num">${fmtMoney(cur.receita_prevista)}</div><div class="lbl">Receita prevista (${cur.competencia})</div></div>
        <div class="stat"><div class="num" style="color:var(--ok)">${fmtMoney(cur.receita_recebida)}</div><div class="lbl">Recebido</div></div>
        <div class="stat"><div class="num">${fmtMoney(cur.despesa_prevista)}</div><div class="lbl">Despesas previstas</div></div>
        <div class="stat"><div class="num" style="color:${(cur.saldo_projetado || 0) >= 0 ? 'var(--ok)' : 'var(--danger)'}">${fmtMoney(cur.saldo_projetado)}</div><div class="lbl">Saldo projetado</div></div>
      </div>
      <div class="card-panel" style="margin-top:16px">
        <h3 style="margin-top:0">Comparativo mês a mês</h3>
        <table class="list">
          <thead><tr><th>Mês</th><th>Receita prevista</th><th>Recebida</th><th>Inadimplência</th><th>Despesa</th><th>Saldo projetado</th><th>Saldo realizado</th></tr></thead>
          <tbody>${d.series.map((s) => `
            <tr>
              <td><b>${s.competencia}</b></td>
              <td>${fmtMoney(s.receita_prevista)}</td>
              <td>${fmtMoney(s.receita_recebida)}</td>
              <td style="color:${s.inadimplencia ? 'var(--danger)' : 'inherit'}">${fmtMoney(s.inadimplencia)}</td>
              <td>${fmtMoney(s.despesa_prevista)}</td>
              <td>${fmtMoney(s.saldo_projetado)}</td>
              <td style="color:${s.saldo_realizado >= 0 ? 'var(--ok)' : 'var(--danger)'}">${fmtMoney(s.saldo_realizado)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="card-panel">
        <h3 style="margin-top:0">Clientes inadimplentes</h3>
        ${d.inadimplentes.length === 0 ? '<p class="muted">Nenhuma cobrança vencida em aberto. 🎉</p>' : `
        <table class="list"><thead><tr><th>Empresa</th><th>Competência</th><th>Valor</th><th>Venceu em</th></tr></thead>
        <tbody>${d.inadimplentes.map((i) => `
          <tr><td>${esc(i.company_name)}</td><td>${i.competencia}</td><td>${fmtMoney(i.amount)}</td><td><span class="badge late">${fmtDate(i.due_date)}</span></td></tr>`).join('')}</tbody></table>`}
      </div>`;
  } else if (tab === 'receber') {
    const rows = await api('/api/fin/receivables');
    body = `
      <div class="toolbar">
        <button class="btn" onclick="genHonorarios()">⚡ Gerar honorários do mês</button>
        <button class="btn secondary" onclick="receivableForm()">+ Cobrança avulsa</button>
      </div>
      <div class="card-panel">
        <table class="list">
          <thead><tr><th>Empresa</th><th>Descrição</th><th>Competência</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map((r) => `
          <tr>
            <td>${esc(r.company_name)}</td><td>${esc(r.description)}</td><td>${r.competencia}</td>
            <td>${fmtMoney(r.amount)}</td>
            <td>${r.status === 'pendente' && r.due_date < today() ? `<span class="badge late">${fmtDate(r.due_date)}</span>` : fmtDate(r.due_date)}</td>
            <td><span class="badge ${r.status === 'recebido' ? 'ok' : (r.due_date < today() ? 'late' : 'warn')}">${r.status === 'pendente' && r.due_date < today() ? 'atrasado' : r.status}</span></td>
            <td style="white-space:nowrap">
              ${r.status === 'pendente'
                ? `<button class="btn small" onclick="markReceived(${r.id})">✓ Recebido</button>`
                : `<button class="btn small secondary" onclick="markPending(${r.id})">Desfazer</button>`}
              <button class="btn small secondary" onclick="delReceivable(${r.id})">✕</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  } else {
    const rows = await api('/api/fin/payables');
    body = `
      <div class="toolbar"><button class="btn" onclick="payableForm()">+ Nova despesa</button></div>
      <div class="card-panel">
        <table class="list">
          <thead><tr><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map((p) => `
          <tr>
            <td>${esc(p.description)} ${p.recurring ? '<span class="badge">fixa</span>' : ''}</td>
            <td>${esc(p.category)}</td><td>${fmtMoney(p.amount)}</td>
            <td>${p.status === 'pendente' && p.due_date < today() ? `<span class="badge late">${fmtDate(p.due_date)}</span>` : fmtDate(p.due_date)}</td>
            <td><span class="badge ${p.status === 'pago' ? 'ok' : (p.due_date < today() ? 'late' : 'warn')}">${p.status === 'pendente' && p.due_date < today() ? 'atrasado' : p.status}</span></td>
            <td style="white-space:nowrap">
              ${p.status === 'pendente'
                ? `<button class="btn small" onclick="markPaid(${p.id})">✓ Pago</button>`
                : `<button class="btn small secondary" onclick="markUnpaid(${p.id})">Desfazer</button>`}
              <button class="btn small secondary" onclick="delPayable(${p.id})">✕</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }
  renderShell('Financeiro do Escritório', tabBar + body);
}

window.genHonorarios = async () => {
  const comp = prompt('Competência (AAAA-MM):', compAtual());
  if (!comp) return;
  const r = await api('/api/fin/receivables/generate', { body: { competencia: comp } });
  toast(`${r.created} cobrança(s) gerada(s) a partir dos honorários cadastrados`);
  router();
};
window.markReceived = async (id) => { await api(`/api/fin/receivables/${id}`, { method: 'PUT', body: { status: 'recebido' } }); router(); };
window.markPending = async (id) => { await api(`/api/fin/receivables/${id}`, { method: 'PUT', body: { status: 'pendente' } }); router(); };
window.delReceivable = async (id) => { if (confirm('Excluir esta cobrança?')) { await api(`/api/fin/receivables/${id}`, { method: 'DELETE' }); router(); } };
window.markPaid = async (id) => { await api(`/api/fin/payables/${id}`, { method: 'PUT', body: { status: 'pago' } }); router(); };
window.markUnpaid = async (id) => { await api(`/api/fin/payables/${id}`, { method: 'PUT', body: { status: 'pendente' } }); router(); };
window.delPayable = async (id) => { if (confirm('Excluir esta despesa?')) { await api(`/api/fin/payables/${id}`, { method: 'DELETE' }); router(); } };

window.receivableForm = () => {
  const m = modal(`
    <h2>Nova cobrança</h2>
    <div class="field"><label>Empresa *</label><select id="rc-company">${selectOptions(COMPANIES, 'id', 'name', '')}</select></div>
    <div class="grid2">
      <div class="field"><label>Descrição</label><input id="rc-desc" value="Honorários"></div>
      <div class="field"><label>Competência</label><input type="month" id="rc-comp" value="${compAtual()}"></div>
      <div class="field"><label>Valor (R$) *</label><input type="number" step="0.01" id="rc-amount"></div>
      <div class="field"><label>Vencimento *</label><input type="date" id="rc-due"></div>
    </div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="rc-save">Salvar</button>
    </div>`);
  m.querySelector('#rc-save').onclick = async () => {
    try {
      await api('/api/fin/receivables', {
        body: {
          company_id: Number(m.querySelector('#rc-company').value),
          description: m.querySelector('#rc-desc').value,
          competencia: m.querySelector('#rc-comp').value,
          amount: Number(m.querySelector('#rc-amount').value),
          due_date: m.querySelector('#rc-due').value,
        },
      });
      m.remove(); router();
    } catch (e) { toast(e.message, true); }
  };
};

window.payableForm = () => {
  const m = modal(`
    <h2>Nova despesa</h2>
    <div class="grid2">
      <div class="field"><label>Descrição *</label><input id="pb-desc"></div>
      <div class="field"><label>Categoria</label>
        <select id="pb-cat">${['aluguel', 'folha', 'software', 'impostos', 'material', 'geral'].map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Valor (R$) *</label><input type="number" step="0.01" id="pb-amount"></div>
      <div class="field"><label>Vencimento *</label><input type="date" id="pb-due"></div>
    </div>
    <div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pb-rec" style="width:auto"> Despesa fixa (recorrente)</label></div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="pb-save">Salvar</button>
    </div>`);
  m.querySelector('#pb-save').onclick = async () => {
    try {
      await api('/api/fin/payables', {
        body: {
          description: m.querySelector('#pb-desc').value.trim(),
          category: m.querySelector('#pb-cat').value,
          amount: Number(m.querySelector('#pb-amount').value),
          due_date: m.querySelector('#pb-due').value,
          recurring: m.querySelector('#pb-rec').checked,
        },
      });
      m.remove(); router();
    } catch (e) { toast(e.message, true); }
  };
};

/* ---------------- usuários (sócias) ---------------- */

async function viewUsuarios() {
  const users = await api('/api/users');
  renderShell('Usuários', `
    <div class="toolbar"><button class="btn" onclick="userForm()">+ Novo usuário</button></div>
    <div class="card-panel">
      <table class="list">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map((u) => `
        <tr>
          <td><b>${esc(u.name)}</b></td>
          <td>${esc(u.email)}</td>
          <td>${u.role === 'socia' ? '👑 Sócia' : 'Colaborador(a)'}</td>
          <td><span class="badge ${u.active ? 'ok' : ''}">${u.active ? 'ativo' : 'inativo'}</span></td>
          <td><button class="btn small secondary" onclick='userForm(${JSON.stringify(u).replace(/'/g, '&#39;')})'>Editar</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`);
}

window.userForm = (u) => {
  u = u || {};
  const m = modal(`
    <h2>${u.id ? 'Editar usuário' : 'Novo usuário'}</h2>
    <div class="grid2">
      <div class="field"><label>Nome *</label><input id="us-name" value="${esc(u.name || '')}"></div>
      <div class="field"><label>E-mail *</label><input id="us-email" value="${esc(u.email || '')}" ${u.id ? 'disabled' : ''}></div>
      <div class="field"><label>Perfil</label>
        <select id="us-role">
          <option value="colaborador" ${u.role !== 'socia' ? 'selected' : ''}>Colaborador</option>
          <option value="socia" ${u.role === 'socia' ? 'selected' : ''}>Sócia (admin)</option>
        </select></div>
      <div class="field"><label>Status</label>
        <select id="us-active"><option value="1" ${u.active !== 0 ? 'selected' : ''}>ativo</option><option value="0" ${u.active === 0 ? 'selected' : ''}>inativo</option></select></div>
    </div>
    <div class="field"><label>${u.id ? 'Redefinir senha (deixe em branco para manter)' : 'Senha inicial (padrão: mudar123)'}</label><input id="us-pass" type="text"></div>
    <div class="actions">
      <button class="btn secondary" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" id="us-save">Salvar</button>
    </div>`);
  m.querySelector('#us-save').onclick = async () => {
    try {
      if (u.id) {
        await api(`/api/users/${u.id}`, {
          method: 'PUT',
          body: {
            name: m.querySelector('#us-name').value.trim(),
            role: m.querySelector('#us-role').value,
            active: m.querySelector('#us-active').value === '1',
            reset_password: m.querySelector('#us-pass').value || undefined,
          },
        });
      } else {
        await api('/api/users', {
          body: {
            name: m.querySelector('#us-name').value.trim(),
            email: m.querySelector('#us-email').value.trim(),
            role: m.querySelector('#us-role').value,
            password: m.querySelector('#us-pass').value || undefined,
          },
        });
      }
      m.remove();
      USERS = await api('/api/users');
      router();
    } catch (e) { toast(e.message, true); }
  };
};

/* ---------------- auditoria (sócias) ---------------- */

async function viewAuditoria() {
  const rows = await api('/api/audit');
  renderShell('Log de Auditoria', `
    <div class="card-panel">
      <p class="muted">Registro de quem alterou o quê e quando (últimas 200 ações).</p>
      <table class="list">
        <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Item</th><th>Detalhe</th></tr></thead>
        <tbody>${rows.map((a) => `
        <tr>
          <td style="white-space:nowrap">${fmtDateTime(a.created_at)}</td>
          <td>${esc(a.user_name || '—')}</td>
          <td>${esc(a.action)}</td>
          <td>${esc(a.entity || '')} ${a.entity_id || ''}</td>
          <td>${esc(a.detail || '')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`);
}

/* ---------------- roteador ---------------- */

const VIEWS = {
  '#/dashboard': viewDashboard,
  '#/kanban': viewKanban,
  '#/empresas': viewEmpresas,
  '#/pagina': viewPagina,
  '#/fechamento': viewFechamento,
  '#/chat': viewChat,
  '#/whatsapp': viewWhatsapp,
  '#/financeiro': viewFinanceiro,
  '#/usuarios': viewUsuarios,
  '#/auditoria': viewAuditoria,
};

async function router() {
  if (!ME) return;
  // Parar timers de polling ao sair das views com polling.
  clearInterval(chatTimer);
  clearInterval(waTimer);
  const hash = location.hash.split('?')[0] || '#/dashboard';
  const content = document.getElementById('content');
  if (content) content.innerHTML = '<p class="muted" style="padding:10px">Carregando…</p>';
  const view = VIEWS[hash] || viewDashboard;
  try {
    await view();
  } catch (e) {
    if (e.message !== 'não autenticado') {
      renderShell('Erro', `<div class="card-panel"><p>⚠️ ${esc(e.message)}</p></div>`);
    }
  }
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('open');
}

window.router = router;
window.addEventListener('hashchange', router);

async function boot() {
  try {
    ME = await api('/api/me');
  } catch {
    return; // renderLogin já foi chamado pelo api()
  }
  USERS = await api('/api/users');
  try { COMPANIES = await api('/api/companies'); } catch { COMPANIES = []; }
  if (!location.hash) location.hash = '#/dashboard';
  router();
}

boot();
