const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './Live-Code-Runner/.env' });

const { Client } = require('pg');

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in environment variables');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Read the migration SQL file
const migrationSql = fs.readFileSync('migrations/0000_initial_schema.sql', 'utf8');

(async () => {
  try {
    await client.connect();
    console.log('🚀 Connected to database...');
    
    await client.query('BEGIN');
    await client.query(migrationSql);
    await client.query('COMMIT');
    
    console.log('✅ Schema created successfully!');
    
    // Quick test
    const res = await client.query('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Users table verified. Row count: ${res.rows[0].count}`);
    
    await client.end();
    console.log('👋 Connection closed.');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration error:', err.message);
    await client.end();
    process.exit(1);
  }
})();