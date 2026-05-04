require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const { exec } = require('child_process');
const fs = require('fs');
const util = require('util');

const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'build')));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL
});

// API Routes

// Execute JavaScript code
app.post('/api/run-code', async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }
  
  // Security checks
  if (code.includes('require(') || code.includes('import') || code.includes('process')) {
    return res.status(400).json({ error: 'Forbidden code detected' });
  }
  
  if (code.length > 5000) {
    return res.status(400).json({ error: 'Code too long' });
  }
  
  try {
    // Create a temporary file with the code
    const tempFileName = `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.js`;
    const tempFilePath = path.join(__dirname, tempFileName);
    
    fs.writeFileSync(tempFilePath, code);
    
    // Execute the code with a timeout
    const timeout = 5000; // 5 seconds
    const command = `node ${tempFilePath}`;
    
    const { stdout, stderr } = await execPromise(command, { timeout });
    
    // Clean up the temporary file
    fs.unlinkSync(tempFilePath);
    
    if (stderr) {
      return res.json({ output: stderr, error: true });
    }
    
    res.json({ output: stdout || 'Code executed successfully (no output)' });
  } catch (error) {
    // Clean up the temporary file if it exists
    try {
      const tempFileName = error.message.match(/temp_\d+_\d+\.js/);
      if (tempFileName) {
        fs.unlinkSync(path.join(__dirname, tempFileName[0]));
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    if (error.killed) {
      return res.status(400).json({ error: 'Code execution timed out' });
    }
    
    res.json({ output: error.message, error: true });
  }
});

// Save a code snippet
app.post('/api/save-code', async (req, res) => {
  const { title, code, mode } = req.body;
  
  if (!title || !code) {
    return res.status(400).json({ error: 'Title and code are required' });
  }
  
  try {
    const result = await pool.query(
      'INSERT INTO snippets (title, js, mode) VALUES ($1, $2, $3) RETURNING *',
      [title, code, mode || 'js']
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save code snippet' });
  }
});

// Get all snippets
async function getAllSnippets(res) {
  try {
    const result = await pool.query('SELECT * FROM snippets ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve snippets' });
  }
}

app.get('/api/get-snippets', (req, res) => getAllSnippets(res));

// Legacy alias
app.get('/api/code-snippets', (req, res) => getAllSnippets(res));

// Serve the React app for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});