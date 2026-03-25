import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [code, setCode] = useState('// Write your JavaScript code here\nconsole.log("Hello, World!");');
  const [output, setOutput] = useState('');
  const [title, setTitle] = useState('');
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch saved snippets on component mount
  useEffect(() => {
    fetchSnippets();
  }, []);

  const fetchSnippets = async () => {
    try {
      const response = await axios.get('/api/code-snippets');
      setSnippets(response.data);
    } catch (error) {
      console.error('Error fetching snippets:', error);
    }
  };

  const runCode = async () => {
    setLoading(true);
    setOutput('');
    
    try {
      const response = await axios.post('/api/run-code', { code });
      setOutput(response.data.output);
    } catch (error) {
      setOutput('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const saveCode = async () => {
    if (!title.trim()) {
      alert('Please enter a title for your code snippet');
      return;
    }

    try {
      await axios.post('/api/save-code', { title, code });
      alert('Code snippet saved successfully!');
      setTitle('');
      fetchSnippets(); // Refresh the snippets list
    } catch (error) {
      alert('Error saving code snippet: ' + (error.response?.data?.error || error.message));
    }
  };

  const loadSnippet = (snippet) => {
    setTitle(snippet.title);
    setCode(snippet.code);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Live Code Runner</h1>
        <p>Write and execute JavaScript code in real-time</p>
      </header>

      <main>
        <div className="container">
          <div className="editor-section">
            <div className="editor-header">
              <h2>Code Editor</h2>
              <div className="editor-controls">
                <button onClick={runCode} disabled={loading}>
                  {loading ? 'Running...' : 'Run Code'}
                </button>
                <div className="save-controls">
                  <input
                    type="text"
                    placeholder="Snippet title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <button onClick={saveCode}>Save Snippet</button>
                </div>
              </div>
            </div>
            
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={15}
              spellCheck="false"
            />
          </div>

          <div className="output-section">
            <h2>Output</h2>
            <pre className="output-box">{output}</pre>
          </div>

          <div className="snippets-section">
            <h2>Saved Snippets</h2>
            {snippets.length > 0 ? (
              <ul className="snippets-list">
                {snippets.map((snippet) => (
                  <li key={snippet.id} onClick={() => loadSnippet(snippet)}>
                    <h3>{snippet.title}</h3>
                    <p>{snippet.code.substring(0, 50)}...</p>
                    <small>{new Date(snippet.created_at).toLocaleString()}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No saved snippets yet.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;