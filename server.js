// Servidor HTTP do sistema Delas — API + arquivos estáticos (SPA).
// Sem dependências externas: Node >= 22.5 (node:sqlite embutido).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handleApi } = require('./src/api');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const STARTED_AT = Date.now();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Headers de segurança presentes em todas as respostas (LGPD / boas práticas).
function setSecurityHeaders(res, isHtml) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );
  if (isHtml) {
    res.setHeader('Cache-Control', 'no-store');
  }
}

const server = http.createServer(async (req, res) => {
  // Health check — antes de qualquer outro handler, sem autenticação.
  if (req.method === 'GET' && req.url === '/api/health') {
    setSecurityHeaders(res, false);
    const db = require('./src/db');
    let dbOk = 'ok';
    try {
      db.prepare('SELECT 1').get();
    } catch {
      dbOk = 'error';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        ok: true,
        uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
        db: dbOk,
        version: require('./package.json').version,
      })
    );
  }

  if (req.url.startsWith('/api/')) {
    setSecurityHeaders(res, false);
    return handleApi(req, res);
  }

  // Estáticos: qualquer rota desconhecida cai no index.html (SPA).
  let file = path.normalize(path.join(PUBLIC_DIR, new URL(req.url, 'http://local').pathname));
  if (!file.startsWith(PUBLIC_DIR)) file = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(file);
  const contentType = MIME[ext] || 'application/octet-stream';
  setSecurityHeaders(res, ext === '.html' || !ext);
  if (ext && ext !== '.html') {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Delas Gestão rodando em http://localhost:${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
