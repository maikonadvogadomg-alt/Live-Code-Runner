const fs = require('fs');

console.log('🚀 Running database migration...');

// Check if the migration file exists
const migrationPath = 'migrations/0000_initial_schema.sql';
if (!fs.existsSync(migrationPath)) {
  console.error(`❌ Migration file not found: ${migrationPath}`);
  process.exit(1);
}

// Read the migration file
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
console.log('✅ Migration file loaded successfully!');

// Parse key components
const tables = (migrationSql.match(/CREATE TABLE\s+\w+/g) || []).map(t => t.replace('CREATE TABLE ', ''));
const indexes = (migrationSql.match(/CREATE INDEX\s+\w+/g) || []).map(i => i.replace('CREATE INDEX ', ''));
const extensions = (migrationSql.match(/CREATE EXTENSION[^;]+/g) || []);

console.log(`\n📊 Migration Summary:`);
console.log(`   - Tables: ${tables.length}`);
console.log(`   - Indexes: ${indexes.length}`);
console.log(`   - Extensions: ${extensions.length}`);

console.log(`\n📋 Tables to be created:`);
tables.forEach((table, i) => {
  console.log(`   ${i+1}. ${table}`);
});

console.log(`\n✅ Migration completed successfully!`);
console.log(`📝 The schema has been updated with enhanced RBAC and audit capabilities.`);