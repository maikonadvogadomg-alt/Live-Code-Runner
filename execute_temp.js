const { exec } = require('child_process');

// Execute the migration
exec('node Live-Code-Runner/scripts/run_migration.js', (error, stdout, stderr) => {
  if (error) {
    console.error(`Error executing migration: ${error}`);
    return;
  }
  if (stderr) {
    console.error(`stderr: ${stderr}`);
  }
  console.log(`Migration output:\n${stdout}`);
});