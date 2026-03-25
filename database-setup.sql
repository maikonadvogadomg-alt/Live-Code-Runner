-- Create the database (run this as a superuser)
-- CREATE DATABASE live_code_runner;

-- Connect to the database
-- \c live_code_runner;

-- Create the code_snippets table
CREATE TABLE IF NOT EXISTS code_snippets (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert some sample data
INSERT INTO code_snippets (title, code) VALUES 
('Hello World', 'console.log("Hello, World!");'),
('Simple Loop', 'for(let i = 0; i < 5; i++) { console.log(i); }'),
('Array Mapping', 'const numbers = [1, 2, 3, 4, 5]; const doubled = numbers.map(n => n * 2); console.log(doubled);');