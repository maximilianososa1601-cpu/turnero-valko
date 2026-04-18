const mysql = require('mysql2/promise');
require('dotenv').config();

const ssl = process.env.DB_SSL === 'true' ? {
  rejectUnauthorized: true,
  ...(process.env.DB_SSL_CA_CONTENT ? {
    ca: Buffer.from(process.env.DB_SSL_CA_CONTENT.replace(/\\n/g, '\n'))
  } : {})
} : false;

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'defaultdb',
  ssl,
  waitForConnections: true,
  connectionLimit:    10,
  timezone:           'Z',
  charset:            'utf8mb4',
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000,
});

pool.getConnection()
  .then(c => { console.log('✅ MySQL conectado'); c.release(); })
  .catch(e => console.error('❌ MySQL error:', e.message));

module.exports = pool;
