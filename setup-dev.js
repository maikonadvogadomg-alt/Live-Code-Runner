const fs = require('fs');
const { execSync } = require('child_process');

console.log('Setting up development environment...');

// Check if .env file exists, if not create it from .env.example
if (!fs.existsSync('.env')) {
  console.log('Creating .env file from .env.example...');
  fs.copyFileSync('.env.example', '.env');
  console.log('Please update the .env file with your database credentials.');
}

// Install dependencies
console.log('Installing dependencies...');
try {
  execSync('npm install', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to install dependencies:', error.message);
  process.exit(1);
}

// Initialize database
console.log('Initializing database...');
try {
  execSync('npm run init-db', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to initialize database:', error.message);
  console.log('Please make sure your database is running and credentials are correct in .env file.');
  process.exit(1);
}

// Build the React app
console.log('Building React application...');
try {
  execSync('npm run build', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to build React app:', error.message);
  process.exit(1);
}

console.log('Development environment setup complete!');
console.log('Run `npm start` to start the application.');