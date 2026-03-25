const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: 'Live-Code-Runner/.env' });

const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const migrationSql = fs.readFileSync('migrations/0000_initial_schema.sql', 'utf8');

(async () => {
  try {
    await client.connect();
    console.log('🚀 Conectado ao banco...');
    
    await client.query('BEGIN');
    await client.query(migrationSql);
    await client.query('COMMIT');
    
    console.log('✅ 13 tabelas criadas!');
    
    // Teste rápido
    const res = await client.query('SELECT 1 FROM users LIMIT 1');
    console.log('✅ Conexão com tabela users verificada!');
    
    await client.end();
    console.log('👋 Conexão encerrada.');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro na migração:', err.message);
    await client.end();
    process.exit(1);
  }
})();