const db = require('../config/db');

async function nextNumero(areaId) {
  await db.query(
    `INSERT INTO secuencias (area_id, fecha, seq) VALUES (?, CURDATE(), 1)
     ON DUPLICATE KEY UPDATE seq = seq + 1`, [areaId]
  );
  const [[{ seq }]] = await db.query(
    'SELECT seq FROM secuencias WHERE area_id=? AND fecha=CURDATE()', [areaId]
  );
  const [[a]] = await db.query('SELECT prefijo FROM areas WHERE id=?', [areaId]);
  return `${a.prefijo}${String(seq).padStart(3, '0')}`;
}

async function enrichTurno(id) {
  const [[t]] = await db.query(`
    SELECT t.*,
      a.nombre AS area_nombre, a.prefijo, a.color AS area_color,
      v.nombre AS ventanilla_nombre, u.nombre AS operador_nombre,
      s.nombre AS sucursal_nombre, td.numero AS derivado_de_num
    FROM turnos t
    JOIN areas a ON a.id=t.area_id
    LEFT JOIN ventanillas v ON v.id=t.ventanilla_id
    LEFT JOIN usuarios    u ON u.id=t.usuario_id
    LEFT JOIN sucursales  s ON s.id=t.sucursal_id
    LEFT JOIN turnos      td ON td.id=t.derivado_de
    WHERE t.id=?`, [id]);
  return t;
}

async function emitir({ orgId, sucursalId, areaId, tipo, canal = 'totem', prioridad = 0, motivoPrioridad = null }) {
  const numero = await nextNumero(areaId);
  const [r] = await db.query(
    `INSERT INTO turnos (org_id, sucursal_id, area_id, numero, tipo, canal, prioridad, motivo_prioridad)
     VALUES (?,?,?,?,?,?,?,?)`,
    [orgId, sucursalId, areaId, numero, tipo, canal, prioridad, motivoPrioridad]
  );
  return enrichTurno(r.insertId);
}

async function llamarSiguiente(ventanillaId, operadorId) {
  const [[vent]] = await db.query('SELECT * FROM ventanillas WHERE id=?', [ventanillaId]);
  if (!vent) throw new Error('Ventanilla no encontrada');

  await db.query(
    `UPDATE turnos SET estado='atendido', hora_fin=NOW(),
       tiempo_atencion_s=TIMESTAMPDIFF(SECOND,COALESCE(hora_inicio_atencion,hora_llamado),NOW())
     WHERE ventanilla_id=? AND estado IN ('llamado','atendiendo')`, [ventanillaId]
  );

  const [[sig]] = await db.query(
    `SELECT id FROM turnos
     WHERE estado='esperando' AND area_id=? AND DATE(hora_emision)=CURDATE()
     ORDER BY prioridad DESC, hora_emision ASC LIMIT 1`, [vent.area_id]
  );
  if (!sig) return null;

  await db.query(
    `UPDATE turnos SET estado='llamado', ventanilla_id=?, usuario_id=?,
       hora_llamado=NOW(), tiempo_espera_s=TIMESTAMPDIFF(SECOND,hora_emision,NOW())
     WHERE id=?`, [ventanillaId, operadorId, sig.id]
  );
  return enrichTurno(sig.id);
}

async function cambiarEstado(turnoId, estado, orgId) {
  const [[t]] = await db.query('SELECT * FROM turnos WHERE id=?', [turnoId]);
  if (!t) throw new Error('Turno no encontrado');
  if (t.org_id !== orgId) throw new Error('Acceso denegado');

  const sets = ['estado=?']; const params = [estado];
  if (estado === 'atendiendo') sets.push('hora_inicio_atencion=NOW()');
  if (['atendido','ausente','cancelado'].includes(estado)) {
    sets.push('hora_fin=NOW()');
    sets.push('tiempo_atencion_s=TIMESTAMPDIFF(SECOND,COALESCE(hora_inicio_atencion,hora_llamado),NOW())');
  }
  params.push(turnoId);
  await db.query(`UPDATE turnos SET ${sets.join(',')} WHERE id=?`, params);
  return enrichTurno(turnoId);
}

async function derivar(turnoId, areaDestinoId, motivo, operadorId, orgId) {
  const [[orig]] = await db.query('SELECT * FROM turnos WHERE id=?', [turnoId]);
  if (!orig || orig.org_id !== orgId) throw new Error('Acceso denegado');

  await db.query(`UPDATE turnos SET estado='derivado', hora_fin=NOW(), motivo_derivacion=? WHERE id=?`,
    [motivo || null, turnoId]);

  const numero = await nextNumero(areaDestinoId);
  const [r] = await db.query(
    `INSERT INTO turnos (org_id,sucursal_id,area_id,numero,tipo,derivado_de,canal,prioridad)
     VALUES (?,?,?,?,?,?,'manual',?)`,
    [orig.org_id, orig.sucursal_id, areaDestinoId, numero, orig.tipo, turnoId, orig.prioridad]
  );
  await db.query('UPDATE turnos SET derivado_a=? WHERE id=?', [r.insertId, turnoId]);
  const [origT, nuevoT] = await Promise.all([enrichTurno(turnoId), enrichTurno(r.insertId)]);
  return { original: origT, nuevo: nuevoT };
}

async function estadoSucursal(sucursalId) {
  const [esperando] = await db.query(`
    SELECT t.*, a.nombre AS area_nombre, a.color AS area_color, a.prefijo,
           td.numero AS derivado_de_num
    FROM turnos t JOIN areas a ON a.id=t.area_id
    LEFT JOIN turnos td ON td.id=t.derivado_de
    WHERE t.sucursal_id=? AND t.estado='esperando' AND DATE(t.hora_emision)=CURDATE()
    ORDER BY t.prioridad DESC, t.hora_emision ASC`, [sucursalId]);

  const [activos] = await db.query(`
    SELECT t.*, a.nombre AS area_nombre, a.color AS area_color,
           v.nombre AS ventanilla_nombre, u.nombre AS operador_nombre
    FROM turnos t JOIN areas a ON a.id=t.area_id
    LEFT JOIN ventanillas v ON v.id=t.ventanilla_id
    LEFT JOIN usuarios    u ON u.id=t.usuario_id
    WHERE t.sucursal_id=? AND t.estado IN ('llamado','atendiendo') AND DATE(t.hora_emision)=CURDATE()
    ORDER BY t.hora_llamado DESC`, [sucursalId]);

  const [[stats]] = await db.query(`
    SELECT
      SUM(estado='esperando')                AS esperando,
      SUM(estado IN ('llamado','atendiendo')) AS activos,
      SUM(estado='atendido')                 AS atendido,
      SUM(estado='ausente')                  AS ausente,
      SUM(estado='derivado')                 AS derivado,
      COUNT(*)                               AS total
    FROM turnos WHERE sucursal_id=? AND DATE(hora_emision)=CURDATE()`, [sucursalId]);

  return { esperando, activos, stats };
}

module.exports = { emitir, llamarSiguiente, cambiarEstado, derivar, estadoSucursal, enrichTurno };
