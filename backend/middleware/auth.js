const jwt = require('jsonwebtoken');
const db  = require('../config/db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-cambiar-en-produccion';

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Token requerido' });

  try {
    const payload = jwt.verify(header.slice(7), SECRET);
    const [[u]] = await db.query(
      `SELECT u.*, o.slug AS org_slug, o.nombre AS org_nombre,
              o.activo AS org_activo, o.color_primario, o.logo_url
       FROM usuarios u
       LEFT JOIN organizaciones o ON o.id = u.org_id
       WHERE u.id = ? AND u.activo = 1`, [payload.sub]
    );
    if (!u) return res.status(401).json({ error: 'Usuario no encontrado' });
    if (u.rol !== 'superadmin' && !u.org_activo)
      return res.status(403).json({ error: 'Organización inactiva' });
    req.user    = u;
    req.orgId   = u.org_id;
    req.payload = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.rol))
      return res.status(403).json({ error: `Requiere rol: ${roles.join(' o ')}` });
    next();
  };
}

function generateToken(u) {
  const { v4: uuid } = require('uuid');
  const token = jwt.sign(
    { sub: u.id, rol: u.rol, org_id: u.org_id, org_slug: u.org_slug, suc_id: u.sucursal_id },
    SECRET, { expiresIn: '8h' }
  );
  return { token, expiresIn: '8h' };
}

module.exports = { requireAuth, requireRole, generateToken };
