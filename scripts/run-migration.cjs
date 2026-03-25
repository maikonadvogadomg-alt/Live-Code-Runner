/**
 * run-migration.cjs
 * Executa a migration inicial do Drizzle manualmente via postgres.js
 *
 * Uso:
 *   node scripts/run-migration.cjs
 *
 * Pré-requisito: DATABASE_URL definida em .env (ou no ambiente)
 */

'use strict';

const path  = require('path');
const fs    = require('fs');

// Carrega o .env da raiz do projeto antes de qualquer coisa
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.DATABASE_URL) {
  console.error('❌  DATABASE_URL não encontrada. Verifique o .env.');
  process.exit(1);
}

// ── Dependências ────────────────────────────────────────────────────────────
const postgres = require('postgres');

// ── Conexão ─────────────────────────────────────────────────────────────────
const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',   // Neon exige SSL
  max: 1,           // uma única conexão é suficiente para migrations
});

// ── Leitura do arquivo SQL ───────────────────────────────────────────────────
const migrationPath = path.resolve(__dirname, '../migrations/0000_initial_schema.sql');

if (!fs.existsSync(migrationPath)) {
  console.error('❌  Arquivo de migration não encontrado:', migrationPath);
  process.exit(1);
}

const migrationSql = fs.readFileSync(migrationPath, 'utf8');

// ── Execução ─────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('🚀  Iniciando migration inicial...\n');

    // Executa todo o DDL dentro de uma transação
    await sql.begin(async (tx) => {
      // postgres.js aceita strings brutas via sql.unsafe() dentro de transações
      await tx.unsafe(migrationSql);
    });

    console.log('✅  DDL executado — tabelas criadas/verificadas com sucesso.\n');

    // ── Tabela de controle do Drizzle ────────────────────────────────────────
    // Drizzle usa "drizzle"."__drizzle_migrations" (schema "drizzle")
    await sql`
      CREATE SCHEMA IF NOT EXISTS "drizzle"
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        "id"         serial      PRIMARY KEY,
        "hash"       varchar(191) NOT NULL,
        "created_at" bigint
      )
    `;

    // Insere somente se ainda não existir (idempotente)
    const existing = await sql`
      SELECT 1 FROM "drizzle"."__drizzle_migrations"
      WHERE hash = 'initial'
      LIMIT 1
    `;

    if (existing.length === 0) {
      await sql`
        INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
        VALUES ('initial', ${BigInt(Date.now())})
      `;
      console.log('📋  Migration registrada na tabela de controle.');
    } else {
      console.log('ℹ️   Migration "initial" já estava registrada — nada inserido.');
    }

    // ── Validação rápida ─────────────────────────────────────────────────────
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`;
    console.log(`\n🔎  Tabela "users" acessível — registros actuais: ${count}`);

    console.log('\n✅  Banco pronto!');
  } catch (err) {
    console.error('\n❌  Erro durante a migration:');
    console.error('    ', err.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
