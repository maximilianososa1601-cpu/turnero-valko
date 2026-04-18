-- 1. Limpieza (Borramos si existe algo para empezar de cero)
DROP TABLE IF EXISTS tokens_revocados CASCADE;
DROP TABLE IF EXISTS configuracion CASCADE;
DROP TABLE IF EXISTS secuencias CASCADE;
DROP TABLE IF EXISTS turnos CASCADE;
DROP TABLE IF EXISTS asignaciones CASCADE;
DROP TABLE IF EXISTS ventanillas CASCADE;
DROP TABLE IF EXISTS areas CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS sucursales CASCADE;
DROP TABLE IF EXISTS organizaciones CASCADE;

-- 2. Creación de Tablas
CREATE TABLE organizaciones (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(60) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  tipo VARCHAR(20) DEFAULT 'other',
  plan VARCHAR(20) DEFAULT 'basic',
  activo BOOLEAN DEFAULT TRUE,
  logo_url TEXT,
  color_primario VARCHAR(7) DEFAULT '#C8A96E',
  max_ventanillas INT DEFAULT 50,
  max_usuarios INT DEFAULT 20,
  timezone VARCHAR(60) DEFAULT 'America/Argentina/Buenos_Aires',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sucursales (
  id SERIAL PRIMARY KEY,
  org_id INT NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
  nombre VARCHAR(120) NOT NULL,
  direccion VARCHAR(200),
  ciudad VARCHAR(80),
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  org_id INT REFERENCES organizaciones(id) ON DELETE CASCADE,
  sucursal_id INT REFERENCES sucursales(id) ON DELETE SET NULL,
  nombre VARCHAR(120) NOT NULL,
  username VARCHAR(60) NOT NULL,
  email VARCHAR(120),
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(20) NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  ultimo_acceso TIMESTAMP,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_username_org UNIQUE (username, org_id)
);

CREATE TABLE areas (
  id SERIAL PRIMARY KEY,
  sucursal_id INT NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  org_id INT NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
  nombre VARCHAR(80) NOT NULL,
  prefijo VARCHAR(2) NOT NULL,
  color VARCHAR(7) DEFAULT '#4A8FD4',
  activo BOOLEAN DEFAULT TRUE,
  orden INT DEFAULT 0,
  CONSTRAINT uq_prefijo_suc UNIQUE (prefijo, sucursal_id)
);

CREATE TABLE ventanillas (
  id SERIAL PRIMARY KEY,
  sucursal_id INT NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  org_id INT NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
  area_id INT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  nombre VARCHAR(80) NOT NULL,
  activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE turnos (
  id BIGSERIAL PRIMARY KEY,
  org_id INT NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
  sucursal_id INT NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  area_id INT NOT NULL REFERENCES areas(id),
  ventanilla_id INT REFERENCES ventanillas(id),
  usuario_id INT REFERENCES usuarios(id),
  numero VARCHAR(10) NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  estado VARCHAR(20) DEFAULT 'esperando',
  prioridad SMALLINT DEFAULT 0,
  motivo_prioridad VARCHAR(80),
  hora_emision TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hora_llamado TIMESTAMP,
  hora_inicio_atencion TIMESTAMP,
  hora_fin TIMESTAMP,
  tiempo_espera_s INT,
  tiempo_atencion_s INT,
  canal VARCHAR(20) DEFAULT 'totem'
);

CREATE TABLE secuencias (
  area_id INT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  seq INT DEFAULT 0,
  PRIMARY KEY (area_id, fecha)
);

CREATE TABLE configuracion (
  org_id INT NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
  clave VARCHAR(80) NOT NULL,
  valor TEXT NOT NULL,
  PRIMARY KEY (org_id, clave)
);

CREATE TABLE tokens_revocados (
  jti VARCHAR(36) PRIMARY KEY,
  expira_en TIMESTAMP NOT NULL
);

-- 3. Carga de Datos Iniciales

-- Superadmin (password: superadmin123)
INSERT INTO usuarios (org_id, nombre, username, email, password_hash, rol) VALUES
  (NULL, 'Super Administrador', 'superadmin', 'admin@sistema.local',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGniYE6Vc.VqKBZERs9xn7Lp1my', 'superadmin');

-- Org 1: Banco Demo
INSERT INTO organizaciones (id, slug, nombre, tipo, plan, color_primario) VALUES
  (1, 'banco-demo', 'Banco Provincial Demo', 'bank', 'pro', '#C8A96E');

INSERT INTO sucursales (id, org_id, nombre, ciudad) VALUES
  (1, 1, 'Casa Central', 'Buenos Aires'),
  (2, 1, 'Sucursal Norte', 'Buenos Aires');

INSERT INTO areas (id, sucursal_id, org_id, nombre, prefijo, color, orden) VALUES
  (1, 1, 1, 'Caja', 'C', '#C8A96E', 1),
  (2, 1, 1, 'Atención al Cliente', 'A', '#7E9EB5', 2),
  (5, 2, 1, 'Caja', 'C', '#C8A96E', 1);

INSERT INTO ventanillas (id, sucursal_id, org_id, area_id, nombre) VALUES
  (1, 1, 1, 1, 'Ventanilla 1'), (2, 1, 1, 1, 'Ventanilla 2');

-- Usuarios (password: admin123)
INSERT INTO usuarios (id, org_id, sucursal_id, nombre, username, password_hash, rol) VALUES
  (2, 1, NULL, 'Admin Banco', 'admin', '$2b$12$rI.aGhQTNXO8hYUV9pjTvOQtX5Z.lk1oTFdGQBXS7G5Xu9MLWN8dC', 'admin'),
  (3, 1, 1, 'Juan Pérez', 'operario1', '$2b$12$rI.aGhQTNXO8hYUV9pjTvOQtX5Z.lk1oTFdGQBXS7G5Xu9MLWN8dC', 'operador'),
  (5, 1, 1, 'Pantalla 1', 'pantalla1', '$2b$12$rI.aGhQTNXO8hYUV9pjTvOQtX5Z.lk1oTFdGQBXS7G5Xu9MLWN8dC', 'pantalla'),
  (6, 1, 1, 'Tótem Entrada', 'totem1', '$2b$12$rI.aGhQTNXO8hYUV9pjTvOQtX5Z.lk1oTFdGQBXS7G5Xu9MLWN8dC', 'totem');

-- 4. Verificación final
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';


