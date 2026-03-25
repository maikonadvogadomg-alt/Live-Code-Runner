import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config({ path: '.env' });

const { Client } = pkg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? true : { rejectUnauthorized: false }
});

const migrationSql = fs.readFileSync(path.resolve('migrations/0000_initial_schema.sql'), 'utf8');

async function setupDatabase() {
  try {
    console.log('🚀 Conectando ao banco de dados...');
    await client.connect();
    console.log('✅ Conectado ao banco!');

    // Executar migração
    console.log('\n📝 Executando migração...');
    await client.query('BEGIN');
    await client.query(migrationSql);
    await client.query('COMMIT');
    console.log('✅ Tabelas criadas com sucesso!');

    // Inserir templates de documentos
    console.log('\n📋 Inserindo templates de documentos...');
    const templatesQuery = `
      INSERT INTO doc_templates (id, titulo, categoria, conteudo)
      VALUES 
        ('tpl-001', 'Petição Inicial', 'Processos Civis', 'Modelo padrão de petição inicial para ação cível'),
        ('tpl-002', 'Contestação', 'Processos Civis', 'Modelo padrão de contestação'),
        ('tpl-003', 'Recurso de Apelação', 'Recursos', 'Modelo padrão de recurso de apelação'),
        ('tpl-004', 'Parecer Jurídico', 'Pareceres', 'Modelo padrão de parecer jurídico'),
        ('tpl-005', 'Contrato de Prestação de Serviços', 'Contratos', 'Modelo padrão de contrato de serviços')
      ON CONFLICT DO NOTHING;
    `;
    await client.query(templatesQuery);
    console.log('✅ Templates de documentos inseridos!');

    // Inserir usuários (advogados)
    console.log('\n👨‍⚖️ Inserindo usuários (advogados)...');
    const usersQuery = `
      INSERT INTO users (id, username, password)
      VALUES 
        ('user-001', 'advogado1', 'senha123'),
        ('user-002', 'advogado2', 'senha456'),
        ('user-003', 'admin_oab', 'admin123')
      ON CONFLICT DO NOTHING;
    `;
    await client.query(usersQuery);
    console.log('✅ Usuários (advogados) inseridos!');

    // Verificar dados
    console.log('\n🔍 Verificando dados inseridos...');
    
    const templatesRes = await client.query('SELECT * FROM doc_templates;');
    console.log(`\n📋 Templates encontrados: ${templatesRes.rows.length}`);
    templatesRes.rows.forEach(row => {
      console.log(`   - ${row.titulo} (${row.categoria})`);
    });

    const usersRes = await client.query('SELECT id, username FROM users;');
    console.log(`\n👨‍⚖️ Usuários encontrados: ${usersRes.rows.length}`);
    usersRes.rows.forEach(row => {
      console.log(`   - ${row.username} (ID: ${row.id})`);
    });

    console.log('\n✅ Setup do banco de dados concluído com sucesso!');
    console.log('\n📊 Resumo:');
    console.log('   ✓ 13 tabelas criadas');
    console.log(`   ✓ ${templatesRes.rows.length} templates de documentos inseridos`);
    console.log(`   ✓ ${usersRes.rows.length} usuários registrados`);

    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Erro:', err.message);
    console.error(err.stack);
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      // Ignore rollback errors
    }
    await client.end();
    process.exit(1);
  }
}

setupDatabase();
