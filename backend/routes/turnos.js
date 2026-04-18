const router = require('express').Router();
const db     = require('../config/db');
const svc    = require('../services/turnos.service');
const { requireAuth, requireRole } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');

// GET /api/turnos/estado?suc_id=X
router.get('/estado', requireAuth, async (req, res) => {
  const sucId = parseInt(req.query.suc_id);
  if (!sucId) return res.status(400).json({ error: 'suc_id requerido' });
  try { res.json(await svc.estadoSucursal(sucId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/turnos/reportes
router.get('/reportes', requireAuth, requireRole('admin','supervisor','superadmin'), async (req, res) => {
  const { suc_id, desde, hasta } = req.query;
  const orgId = req.orgId;
  const f1 = desde || new Date().toISOString().slice(0,10);
  const f2 = hasta || f1;
  const sucCond = suc_id ? `AND t.sucursal_id=${parseInt(suc_id)}` : '';
  const orgCond = req.user.rol !== 'superadmin' ? `AND t.org_id=${orgId}` : '';
  try {
    const [[totales]] = await db.query(`
      SELECT COUNT(*) AS total, SUM(estado='atendido') AS atendidos,
             SUM(estado='ausente') AS ausentes, SUM(estado='derivado') AS derivados,
             ROUND(AVG(tiempo_espera_s)) AS espera_prom_s,
             ROUND(AVG(tiempo_atencion_s)) AS atencion_prom_s,
             ROUND(SUM(estado='atendido')*100.0/NULLIF(COUNT(*),0)) AS eficiencia
      FROM turnos t WHERE DATE(hora_emision) BETWEEN ? AND ? ${sucCond} ${orgCond}`, [f1, f2]);

    const [por_area] = await db.query(`
      SELECT a.nombre, a.color, COUNT(t.id) AS total,
             SUM(t.estado='atendido') AS atendidos, SUM(t.estado='ausente') AS ausentes,
             ROUND(AVG(t.tiempo_espera_s)) AS espera_prom_s
      FROM turnos t JOIN areas a ON a.id=t.area_id
      WHERE DATE(t.hora_emision) BETWEEN ? AND ? ${sucCond} ${orgCond}
      GROUP BY a.id ORDER BY total DESC`, [f1, f2]);

    const [por_dia] = await db.query(`
      SELECT DATE(hora_emision) AS fecha, COUNT(*) AS total,
             SUM(estado='atendido') AS atendidos
      FROM turnos t WHERE DATE(hora_emision) BETWEEN ? AND ? ${sucCond} ${orgCond}
      GROUP BY DATE(hora_emision) ORDER BY fecha`, [f1, f2]);

    const [por_ventanilla] = await db.query(`
      SELECT v.nombre AS ventanilla, a.nombre AS area, u.nombre AS operador,
             COUNT(t.id) AS total, SUM(t.estado='atendido') AS atendidos,
             ROUND(AVG(t.tiempo_atencion_s)) AS atencion_prom_s
      FROM turnos t
      JOIN ventanillas v ON v.id=t.ventanilla_id
      JOIN areas a ON a.id=t.area_id
      LEFT JOIN usuarios u ON u.id=t.usuario_id
      WHERE DATE(t.hora_emision) BETWEEN ? AND ? ${sucCond} ${orgCond}
        AND t.ventanilla_id IS NOT NULL
      GROUP BY t.ventanilla_id ORDER BY total DESC`, [f1, f2]);

    res.json({ totales, por_area, por_dia, por_ventanilla, desde: f1, hasta: f2 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/turnos
router.get('/', requireAuth, async (req, res) => {
  const { suc_id, estado, fecha, limit = 200 } = req.query;
  let sql = `SELECT t.*, a.nombre AS area_nombre, a.color AS area_color,
               v.nombre AS ventanilla_nombre, u.nombre AS operador_nombre,
               td.numero AS derivado_de_num
             FROM turnos t JOIN areas a ON a.id=t.area_id
             LEFT JOIN ventanillas v ON v.id=t.ventanilla_id
             LEFT JOIN usuarios    u ON u.id=t.usuario_id
             LEFT JOIN turnos      td ON td.id=t.derivado_de
             WHERE t.org_id=?`;
  const params = [req.orgId];
  if (suc_id)  { sql+=' AND t.sucursal_id=?'; params.push(suc_id); }
  if (estado)  { sql+=' AND t.estado=?';       params.push(estado); }
  sql += ` AND DATE(t.hora_emision)=${fecha?'?':'CURDATE()'}`;
  if (fecha) params.push(fecha);
  sql += ' ORDER BY t.hora_emision DESC LIMIT ?';
  params.push(parseInt(limit));
  try { const [rows]=await db.query(sql,params); res.json(rows); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// POST /api/turnos
router.post('/', requireAuth, requireRole('totem','admin','supervisor','operador'), async (req, res) => {
  const { area_id, tipo, prioridad=0, motivo_prioridad=null, canal='totem', suc_id } = req.body;
  if (!area_id||!tipo||!suc_id) return res.status(400).json({ error: 'area_id, tipo y suc_id requeridos' });
  try {
    const [[area]] = await db.query('SELECT org_id FROM areas WHERE id=?', [area_id]);
    if (!area||area.org_id!==req.orgId) return res.status(403).json({ error: 'Área no pertenece a su organización' });
    const turno = await svc.emitir({ orgId:req.orgId, sucursalId:parseInt(suc_id), areaId:parseInt(area_id), tipo, canal, prioridad:parseInt(prioridad), motivoPrioridad:motivo_prioridad });
    broadcast(req.orgId, 'turno_emitido', turno, parseInt(suc_id));
    res.status(201).json(turno);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST /api/turnos/llamar
router.post('/llamar', requireAuth, requireRole('operador','admin','supervisor'), async (req, res) => {
  const { ventanilla_id, suc_id } = req.body;
  if (!ventanilla_id) return res.status(400).json({ error: 'ventanilla_id requerido' });
  try {
    const turno = await svc.llamarSiguiente(parseInt(ventanilla_id), req.user.id);
    if (!turno) return res.status(404).json({ error: 'Sin turnos en espera' });
    broadcast(req.orgId, 'turno_llamado', turno, suc_id?parseInt(suc_id):turno.sucursal_id);
    res.json(turno);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PUT /api/turnos/:id/estado
router.put('/:id/estado', requireAuth, async (req, res) => {
  const VALID = ['esperando','llamado','atendiendo','atendido','ausente','cancelado'];
  if (!VALID.includes(req.body.estado)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    const turno = await svc.cambiarEstado(parseInt(req.params.id), req.body.estado, req.orgId);
    broadcast(req.orgId, 'turno_actualizado', turno, turno.sucursal_id);
    res.json(turno);
  } catch(e) { res.status(e.message==='Acceso denegado'?403:500).json({error:e.message}); }
});

// POST /api/turnos/:id/derivar
router.post('/:id/derivar', requireAuth, requireRole('operador','admin','supervisor'), async (req, res) => {
  const { area_id_destino, motivo } = req.body;
  if (!area_id_destino) return res.status(400).json({ error: 'area_id_destino requerido' });
  try {
    const result = await svc.derivar(parseInt(req.params.id), parseInt(area_id_destino), motivo, req.user.id, req.orgId);
    broadcast(req.orgId,'turno_derivado',result,result.original.sucursal_id);
    broadcast(req.orgId,'turno_emitido',result.nuevo,result.nuevo.sucursal_id);
    broadcast(req.orgId,'turno_actualizado',result.original,result.original.sucursal_id);
    res.status(201).json(result);
  } catch(e) { res.status(e.message==='Acceso denegado'?403:500).json({error:e.message}); }
});

module.exports = router;
