console.log('Node.js version:', process.version);
console.log('Current working directory:', process.cwd());

// Check if required modules are available
try {
  require('fs');
  console.log('✅ fs module available');
} catch (e) {
  console.log('❌ fs module not available:', e.message);
}

try {
  require('path');
  console.log('✅ path module available');
} catch (e) {
  console.log('❌ path module not available:', e.message);
}

try {
  require('pg');
  console.log('✅ pg module available');
} catch (e) {
  console.log('❌ pg module not available:', e.message);
}