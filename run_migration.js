const { exec } = require('child_process');
const path = require('path');

// Change to the Live-Code-Runner directory and run the migration
const command = 'cd Live-Code-Runner && node scripts/run_migration.js';

exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`Erro ao executar a migração: ${error}`);
    return;
  }
  if (stderr) {
    console.error(`Erro: ${stderr}`);
    return;
  }
  console.log(`Saída: ${stdout}`);
});