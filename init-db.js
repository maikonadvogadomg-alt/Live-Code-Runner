require('dotenv').config();
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgres://user:password@localhost:5432/live_code_runner'
});

// SQL to create the table
const createTableSQL = `
CREATE TABLE IF NOT EXISTS code_snippets (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert some sample data if the table is empty
INSERT INTO code_snippets (title, code) 
SELECT 'Hello World', 'console.log("Hello, World!");'
WHERE NOT EXISTS (SELECT 1 FROM code_snippets);

INSERT INTO code_snippets (title, code) 
SELECT 'Simple Loop', 'for(let i = 0; i < 5; i++) { console.log(i); }'
WHERE NOT EXISTS (SELECT 1 FROM code_snippets);

INSERT INTO code_snippets (title, code) 
SELECT 'Array Mapping', 'const numbers = [1, 2, 3, 4, 5]; const doubled = numbers.map(n => n * 2); console.log(doubled);'
WHERE NOT EXISTS (SELECT 1 FROM code_snippets);
`;

async function initDB() {
  try {
    console.log('Initializing database...');
    
    // Execute the SQL
    await pool.query(createTableSQL);
    
    console.log('Database initialized successfully!');
    
    // Close the pool
    await pool.end();
  } catch (err) {
    console.error('Error initializing database:', err);
    process.exit(1);
  }
}

// Run the initialization
initDB();