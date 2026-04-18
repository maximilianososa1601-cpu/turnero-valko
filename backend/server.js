require('dotenv').config();
const express    = require('express');
const http       = require('http');
const path       = require('path');
const cors       = require('cors');
const helmet     = require('helmet');
const compression= require('compression');
const rateLimit  = require('express-rate-limit');

const { initWS, getStats } = require('./ws/broadcast');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', 1);

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, max: 500,
  standardHeaders: true, legacyHeaders: false,
}));

// ── Frontends estáticos ──────────────────────────────────────
const FE = path.join(__dirname, '../frontend');
app.use('/shared',     express.static(path.join(FE, 'shared')));
app.use('/superadmin', express.static(path.join(FE, 'superadmin')));
app.use('/admin',      express.static(path.join(FE, 'admin')));
app.use('/operador',   express.static(path.join(FE, 'operador')));
app.use('/pantalla',   express.static(path.join(FE, 'pantalla')));
app.use('/totem',      express.static(path.join(FE, 'totem')));

app.get('/login',      (req, res) => res.sendFile(path.join(FE, 'shared/login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(FE, 'shared/login.html')));

// Acceso por slug: /banco-demo/totem → /totem/?org=banco-demo
const db = require('./config/db');
app.get('/:orgSlug/:modulo(totem|operador|pantalla|admin|superadmin)', async (req, res) => {
  const { orgSlug, modulo } = req.params;
  try {
    const [[org]] = await db.query('SELECT id FROM organizaciones WHERE slug=? AND activo=1', [orgSlug]);
    if (!org) return res.redirect('/login?error=org_not_found');
  } catch {}
  res.redirect(`/${modulo}/?org=${orgSlug}`);
});

app.get('/:orgSlug', (req, res) => {
  const skip = ['api','shared','admin','superadmin','operador','pantalla','totem','login'];
  if (skip.includes(req.params.orgSlug)) return res.status(404).send('Not found');
  res.redirect(`/login?org=${req.params.orgSlug}`);
});

// ── API ──────────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/turnos', require('./routes/turnos'));
app.use('/api/orgs',   require('./routes/organizaciones'));

app.get('/api/health', (req, res) => res.json({
  ok: true, version: '3.0.0',
  uptime: Math.round(process.uptime()),
  ws: getStats(),
}));
app.get('/ping', (req, res) => res.send('pong'));

// ── Página de inicio ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Sistema de Turnos</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Barlow',sans-serif;background:#080C12;color:#D4D8E1;min-height:100vh;display:flex;align-items:center;justify-content:center;}
    .w{max-width:480px;width:100%;padding:40px 20px;}
    h1{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#C8A96E;margin-bottom:4px;}
    p{font-size:12px;color:#6B7590;margin-bottom:28px;}
    a{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;background:#0E1117;border:1px solid #252D3D;color:#D4D8E1;text-decoration:none;margin-bottom:8px;transition:border-color .15s;}
    a:hover{border-color:#C8A96E;}
    .al{font-weight:700;font-size:14px;} .as{font-size:11px;color:#6B7590;margin-top:2px;}
    .ab{font-size:9px;padding:2px 8px;background:#252D3D;color:#C8A96E;letter-spacing:.08em;text-transform:uppercase;}
    .sep{height:1px;background:#252D3D;margin:14px 0;}
  </style>
</head>
<body><div class="w">
  <h1>Sistema de Turnos</h1>
  <p>Multi-tenant · Render + Aiven</p>
  <a href="/superadmin"><div><div class="al">Super Admin</div><div class="as">Gestión global</div></div><span class="ab">GLOBAL</span></a>
  <div class="sep"></div>
  <a href="/login"><div><div class="al">Login</div><div class="as">Acceso a todos los módulos</div></div><span class="ab">AUTH</span></a>
  <a href="/totem"><div><div class="al">Tótem</div><div class="as">Emisión de turnos</div></div><span class="ab">MÓDULO</span></a>
  <a href="/operador"><div><div class="al">Operador</div><div class="as">Panel de ventanilla</div></div><span class="ab">MÓDULO</span></a>
  <a href="/pantalla"><div><div class="al">Pantalla TV</div><div class="as">Visualización pública</div></div><span class="ab">MÓDULO</span></a>
  <a href="/admin"><div><div class="al">Admin</div><div class="as">Administración + reportes</div></div><span class="ab">MÓDULO</span></a>
  <div class="sep"></div>
  <a href="/api/health"><div><div class="al">Health</div></div><span class="ab">API</span></a>
</div></body></html>`);
});

app.use((req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Turnero corriendo en puerto ${PORT}`);
});

initWS(server);

process.on('SIGTERM', () => server.close(() => process.exit(0)));
