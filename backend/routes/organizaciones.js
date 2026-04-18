const router = require('express').Router();
const bcrypt = require('bcrypt');
const db     = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { broadcast, broadcastSuper } = require('../ws/broadcast');

// GET /api/orgs
router.get('/', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const [orgs] = await db.query(`
      SELECT o.*,
        (SELECT COUNT(*) FROM sucursales s WHERE s.org_id=o.id AND s.activo=1) AS num_sucursales,
        (SELECT COUNT(*) FROM usuarios   u WHERE u.org_id=o.id AND u.activo=1) AS num_usuarios,
        (SELECT COUNT(*) FROM turnos     t WHERE t.org_id=o.id AND DATE(t.hora_emision)=CURDATE()) AS turnos_hoy
      FROM organizaciones o ORDER BY o.nombre`);
    res.json(orgs);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST /api/orgs
router.post('/', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { slug,nombre,tipo,plan,color_primario,admin_nombre,admin_username,admin_password,admin_email } = req.body;
  if (!slug||!nombre||!admin_username||!admin_password)
    return res.status(400).json({ error: 'slug, nombre, admin_username y admin_password requeridos' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO organizaciones (slug,nombre,tipo,plan,color_primario) VALUES (?,?,?,?,?)`,
      [slug,nombre,tipo||'other',plan||'basic',color_primario||'#C8A96E']
    );
    const orgId = r.insertId;
    await conn.query('INSERT INTO sucursales (org_id,nombre) VALUES (?,?)', [orgId,'Casa Central']);
    const hash = await bcrypt.hash(admin_password, 12);
    await conn.query(
      `INSERT INTO usuarios (org_id,nombre,username,email,password_hash,rol) VALUES (?,?,?,?,?,'admin')`,
      [orgId,admin_nombre||'Administrador',admin_username,admin_email||null,hash]
    );
    await conn.query(
      `INSERT INTO configuracion (org_id,clave,valor) VALUES (?,?,?),(?,?,?),(?,?,?)`,
      [orgId,'slogan','Sistema de Turnos', orgId,'ticket_width','80mm', orgId,'auto_print','1']
    );
    await conn.commit();
    broadcastSuper('org_created', { id:orgId, slug, nombre });
    res.status(201).json({ id:orgId, slug, nombre });
  } catch(e) {
    await conn.rollback();
    if (e.code==='ER_DUP_ENTRY') return res.status(409).json({ error: 'El slug ya existe' });
    res.status(500).json({error:e.message});
  } finally { conn.release(); }
});

// PUT /api/orgs/:id
router.put('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { nombre,plan,activo,color_primario,logo_url } = req.body;
  await db.query(
    `UPDATE organizaciones SET nombre=COALESCE(?,nombre),plan=COALESCE(?,plan),
       activo=COALESCE(?,activo),color_primario=COALESCE(?,color_primario),logo_url=COALESCE(?,logo_url)
     WHERE id=?`, [nombre,plan,activo,color_primario,logo_url,req.params.id]
  );
  const [[org]] = await db.query('SELECT * FROM organizaciones WHERE id=?', [req.params.id]);
  res.json(org);
});

// GET /api/orgs/:orgId/sucursales
router.get('/:orgId/sucursales', requireAuth, async (req, res) => {
  const orgId = parseInt(req.params.orgId);
  if (req.user.rol!=='superadmin'&&req.orgId!==orgId) return res.status(403).json({error:'Acceso denegado'});
  const [rows] = await db.query('SELECT * FROM sucursales WHERE org_id=? ORDER BY nombre', [orgId]);
  res.json(rows);
});

// POST /api/orgs/:orgId/sucursales
router.post('/:orgId/sucursales', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const orgId = parseInt(req.params.orgId);
  if (req.user.rol!=='superadmin'&&req.orgId!==orgId) return res.status(403).json({error:'Acceso denegado'});
  const { nombre,direccion,ciudad } = req.body;
  if (!nombre) return res.status(400).json({error:'nombre requerido'});
  const [r] = await db.query('INSERT INTO sucursales (org_id,nombre,direccion,ciudad) VALUES (?,?,?,?)',[orgId,nombre,direccion,ciudad]);
  const [[s]] = await db.query('SELECT * FROM sucursales WHERE id=?',[r.insertId]);
  res.status(201).json(s);
});

// GET /api/orgs/areas/list?suc_id=X
router.get('/areas/list', requireAuth, async (req, res) => {
  const sucId = parseInt(req.query.suc_id);
  if (!sucId) return res.status(400).json({error:'suc_id requerido'});
  const [areas] = await db.query('SELECT * FROM areas WHERE sucursal_id=? ORDER BY orden,nombre', [sucId]);
  const [vents] = await db.query('SELECT * FROM ventanillas WHERE sucursal_id=? AND activo=1 ORDER BY nombre', [sucId]);
  res.json(areas.map(a=>({...a, ventanillas: vents.filter(v=>v.area_id===a.id)})));
});

// POST /api/orgs/areas
router.post('/areas', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const { suc_id,nombre,prefijo,color,orden } = req.body;
  if (!suc_id||!nombre||!prefijo) return res.status(400).json({error:'suc_id, nombre y prefijo requeridos'});
  try {
    const [[s]] = await db.query('SELECT org_id FROM sucursales WHERE id=?',[suc_id]);
    if (!s||(req.user.rol!=='superadmin'&&s.org_id!==req.orgId)) return res.status(403).json({error:'Acceso denegado'});
    const [r] = await db.query('INSERT INTO areas (sucursal_id,org_id,nombre,prefijo,color,orden) VALUES (?,?,?,?,?,?)',
      [suc_id,s.org_id,nombre,prefijo.toUpperCase().slice(0,2),color||'#4A8FD4',orden||0]);
    const [[area]] = await db.query('SELECT * FROM areas WHERE id=?',[r.insertId]);
    res.status(201).json(area);
  } catch(e) {
    if (e.code==='ER_DUP_ENTRY') return res.status(409).json({error:'El prefijo ya existe en esta sucursal'});
    res.status(500).json({error:e.message});
  }
});

// PUT /api/orgs/areas/:id
router.put('/areas/:id', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const { nombre,color,activo,orden } = req.body;
  await db.query('UPDATE areas SET nombre=COALESCE(?,nombre),color=COALESCE(?,color),activo=COALESCE(?,activo),orden=COALESCE(?,orden) WHERE id=?',
    [nombre,color,activo,orden,req.params.id]);
  const [[area]] = await db.query('SELECT * FROM areas WHERE id=?',[req.params.id]);
  res.json(area);
});

// POST /api/orgs/ventanillas
router.post('/ventanillas', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const { suc_id,area_id,nombre } = req.body;
  if (!suc_id||!area_id||!nombre) return res.status(400).json({error:'suc_id, area_id y nombre requeridos'});
  const [[s]] = await db.query('SELECT org_id FROM sucursales WHERE id=?',[suc_id]);
  if (!s||(req.user.rol!=='superadmin'&&s.org_id!==req.orgId)) return res.status(403).json({error:'Acceso denegado'});
  const [r] = await db.query('INSERT INTO ventanillas (sucursal_id,org_id,area_id,nombre) VALUES (?,?,?,?)',[suc_id,s.org_id,area_id,nombre]);
  const [[v]] = await db.query('SELECT * FROM ventanillas WHERE id=?',[r.insertId]);
  res.status(201).json(v);
});

// PUT /api/orgs/ventanillas/:id
router.put('/ventanillas/:id', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const { nombre,activo,area_id } = req.body;
  await db.query('UPDATE ventanillas SET nombre=COALESCE(?,nombre),activo=COALESCE(?,activo),area_id=COALESCE(?,area_id) WHERE id=?',
    [nombre,activo,area_id,req.params.id]);
  const [[v]] = await db.query('SELECT * FROM ventanillas WHERE id=?',[req.params.id]);
  res.json(v);
});

// POST /api/orgs/asignaciones
router.post('/asignaciones', requireAuth, requireRole('admin','supervisor','superadmin'), async (req, res) => {
  const { usuario_id,ventanilla_id } = req.body;
  if (!usuario_id||!ventanilla_id) return res.status(400).json({error:'usuario_id y ventanilla_id requeridos'});
  await db.query(
    `INSERT INTO asignaciones (usuario_id,ventanilla_id,fecha) VALUES (?,?,CURDATE())
     ON DUPLICATE KEY UPDATE ventanilla_id=?,activo=1`, [usuario_id,ventanilla_id,ventanilla_id]
  );
  res.json({ok:true});
});

// GET /api/orgs/:orgId/usuarios
router.get('/:orgId/usuarios', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const orgId = parseInt(req.params.orgId);
  if (req.user.rol!=='superadmin'&&req.orgId!==orgId) return res.status(403).json({error:'Acceso denegado'});
  const [rows] = await db.query(
    `SELECT u.id,u.nombre,u.username,u.email,u.rol,u.activo,u.sucursal_id,u.ultimo_acceso,
            s.nombre AS sucursal_nombre
     FROM usuarios u LEFT JOIN sucursales s ON s.id=u.sucursal_id
     WHERE u.org_id=? ORDER BY u.rol,u.nombre`, [orgId]
  );
  res.json(rows);
});

// POST /api/orgs/:orgId/usuarios
router.post('/:orgId/usuarios', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const orgId = parseInt(req.params.orgId);
  if (req.user.rol!=='superadmin'&&req.orgId!==orgId) return res.status(403).json({error:'Acceso denegado'});
  const { nombre,username,password,email,rol,sucursal_id } = req.body;
  if (!nombre||!username||!password||!rol) return res.status(400).json({error:'Campos requeridos'});
  try {
    const hash = await bcrypt.hash(password, 12);
    const [r] = await db.query(
      'INSERT INTO usuarios (org_id,sucursal_id,nombre,username,email,password_hash,rol) VALUES (?,?,?,?,?,?,?)',
      [orgId,sucursal_id||null,nombre,username,email||null,hash,rol]
    );
    const [[u]] = await db.query('SELECT id,nombre,username,email,rol,activo FROM usuarios WHERE id=?',[r.insertId]);
    res.status(201).json(u);
  } catch(e) {
    if (e.code==='ER_DUP_ENTRY') return res.status(409).json({error:'Username ya existe'});
    res.status(500).json({error:e.message});
  }
});

// PUT /api/orgs/usuarios/:id
router.put('/usuarios/:id', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const { nombre,email,rol,activo,sucursal_id,password } = req.body;
  const sets=['nombre=COALESCE(?,nombre)','email=COALESCE(?,email)','rol=COALESCE(?,rol)','activo=COALESCE(?,activo)'];
  const params=[nombre,email,rol,activo];
  if (password) { sets.push('password_hash=?'); params.push(await bcrypt.hash(password,12)); }
  params.push(req.params.id);
  await db.query(`UPDATE usuarios SET ${sets.join(',')} WHERE id=?`, params);
  const [[u]] = await db.query('SELECT id,nombre,username,email,rol,activo FROM usuarios WHERE id=?',[req.params.id]);
  res.json(u);
});

// GET/PUT /api/orgs/:orgId/config
router.get('/:orgId/config', requireAuth, async (req, res) => {
  const orgId = parseInt(req.params.orgId);
  if (req.user.rol!=='superadmin'&&req.orgId!==orgId) return res.status(403).json({error:'Acceso denegado'});
  const [rows] = await db.query('SELECT clave,valor FROM configuracion WHERE org_id=?',[orgId]);
  const [[org]] = await db.query('SELECT nombre,slug,tipo,logo_url,color_primario FROM organizaciones WHERE id=?',[orgId]);
  res.json({...org, config: Object.fromEntries(rows.map(r=>[r.clave,r.valor]))});
});

router.put('/:orgId/config', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const orgId = parseInt(req.params.orgId);
  if (req.user.rol!=='superadmin'&&req.orgId!==orgId) return res.status(403).json({error:'Acceso denegado'});
  const { config={}, nombre, logo_url, color_primario } = req.body;
  const sets=[]; const prms=[];
  if (nombre)        { sets.push('nombre=?');        prms.push(nombre); }
  if (logo_url)      { sets.push('logo_url=?');      prms.push(logo_url); }
  if (color_primario){ sets.push('color_primario=?'); prms.push(color_primario); }
  if (sets.length)   { prms.push(orgId); await db.query(`UPDATE organizaciones SET ${sets.join(',')} WHERE id=?`,prms); }
  for (const [k,v] of Object.entries(config))
    await db.query('INSERT INTO configuracion (org_id,clave,valor) VALUES (?,?,?) ON DUPLICATE KEY UPDATE valor=?',[orgId,k,v,v]);
  const [rows] = await db.query('SELECT clave,valor FROM configuracion WHERE org_id=?',[orgId]);
  res.json({ok:true, config: Object.fromEntries(rows.map(r=>[r.clave,r.valor]))});
});

module.exports = router;
