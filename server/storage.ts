// Updating pg.Pool ssl parameter

const { Pool } = require('pg');

const pool = new Pool({
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;