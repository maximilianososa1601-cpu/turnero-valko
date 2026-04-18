const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret-cambiar-en-produccion';
let wss = null;

function initWS(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', ws => {
    ws.isAlive = true; ws.orgId = null; ws.sucId = null; ws.view = null;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'auth' && msg.token) {
          try { const p = jwt.verify(msg.token, SECRET); ws.orgId = p.org_id; ws.sucId = p.suc_id; } catch {}
        }
        if (msg.type === 'subscribe') {
          ws.view  = msg.view || null;
          ws.sucId = msg.suc_id ? parseInt(msg.suc_id) : ws.sucId;
          if (msg.org_id && !ws.orgId) ws.orgId = msg.org_id;
        }
      } catch {}
    });
    ws.on('error', () => {});
    ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
  });
  const hb = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false; ws.ping();
    });
  }, 30000);
  wss.on('close', () => clearInterval(hb));
  console.log('🔌 WebSocket listo');
}

function broadcast(orgId, type, data, sucId = null) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(c => {
    if (c.readyState !== 1) return;
    if (c.orgId && c.orgId !== orgId) return;
    if (sucId && c.sucId && c.sucId !== sucId) return;
    try { c.send(msg); } catch {}
  });
}

function broadcastSuper(type, data) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === 1 && c.view === 'superadmin') try { c.send(msg); } catch {} });
}

function getStats() {
  if (!wss) return { total: 0 };
  return { total: wss.clients.size };
}

module.exports = { initWS, broadcast, broadcastSuper, getStats };
