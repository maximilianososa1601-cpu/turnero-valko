const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const rateLimit = require('express-rate-limit');
const db      = require('../config/db');
const { requireAuth, generateToken } = require('../middleware/auth');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Demasiados intentos. Espere 15 minutos.' }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, org_slug } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  try {
    let sql = `SELECT u.*, o.slug AS org_slug, o.nombre AS org_nombre,
                      o.activo AS org_activo, o.color_primario, o.logo_url, o.tipo AS org_tipo
               FROM usuarios u
               LEFT JOIN organizaciones o ON o.id = u.org_id
               WHERE u.username=? AND u.activo=1`;
    const params = [username];
    if (org_slug) { sql += ' AND o.slug=?'; params.push(org_slug); }
    sql += ' LIMIT 1';

    const [[u]] = await db.query(sql, params);
    if (!u) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (u.rol !== 'superadmin' && !u.org_activo)
      return res.status(403).json({ error: 'Organización inactiva' });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    await db.query('UPDATE usuarios SET ultimo_acceso=NOW() WHERE id=?', [u.id]);

    let sucursales = [];
    if (u.org_id) {
      const cond = u.sucursal_id ? 'AND s.id=?' : '';
      const prms = u.sucursal_id ? [u.org_id, u.sucursal_id] : [u.org_id];
      [sucursales] = await db.query(
        `SELECT id, nombre, ciudad FROM sucursales WHERE org_id=? AND activo=1 ${cond} ORDER BY nombre`, prms
      );
    }

    const { token, expiresIn } = generateToken(u);
    const { password_hash, ...safe } = u;
    res.json({ token, expiresIn, user: { ...safe, sucursales } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => res.json({ ok: true }));

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const u = req.user;
  let ventanilla = null;
  if (u.rol === 'operador') {
    const [[asig]] = await db.query(
      `SELECT v.id, v.nombre, a.id AS area_id, a.nombre AS area_nombre, a.prefijo, a.color
       FROM asignaciones asig
       JOIN ventanillas v ON v.id=asig.ventanilla_id
       JOIN areas a ON a.id=v.area_id
       WHERE asig.usuario_id=? AND asig.fecha=CURDATE() AND asig.activo=1 LIMIT 1`, [u.id]
    );
    ventanilla = asig || null;
  }
  const { password_hash, ...safe } = u;
  res.json({ user: safe, ventanilla });
});

module.exports = router;
