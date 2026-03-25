import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link } from "wouter";
import {
  Play,
  Save,
  FolderOpen,
  Download,
  Trash2,
  Atom,
  Gavel,
  Loader2,
  Search,
  Pencil,
  Check,
  X,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Snippet } from "@shared/schema";

const DEFAULT_JSX = `// Componente React — edite e clique em Executar
function App() {
  const [count, setCount] = React.useState(0);

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '40px auto', padding: 24,
      background: '#1e293b', borderRadius: 16, color: '#e2e8f0', textAlign: 'center' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>⚛️ React Playground</h1>
      <p style={{ color: '#94a3b8', marginBottom: 24 }}>Escreva componentes React e veja ao vivo!</p>
      <div style={{ fontSize: 64, fontWeight: 900, margin: '16px 0', color: '#6366f1' }}>{count}</div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button onClick={() => setCount(c => c - 1)}
          style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#ef4444',
            color: 'white', fontSize: 20, cursor: 'pointer', fontWeight: 700 }}>−</button>
        <button onClick={() => setCount(0)}
          style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#475569',
            color: 'white', fontSize: 14, cursor: 'pointer', fontWeight: 700 }}>Reset</button>
        <button onClick={() => setCount(c => c + 1)}
          style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#22c55e',
            color: 'white', fontSize: 20, cursor: 'pointer', fontWeight: 700 }}>+</button>
      </div>
    </div>
  );
}
`;

const AUTOSAVE_KEY = "react-playground-autosave";

function preprocessJSX(code: string): string {
  return code
    .replace(/^\s*import\s+React[^;]*;?\s*\n?/gm, "")
    .replace(/^\s*import\s+ReactDOM[^;]*;?\s*\n?/gm, "")
    .replace(/^\s*import\s+\{[^}]*\}\s+from\s+['"]react['"][;]?\s*\n?/gm, "")
    .replace(/^\s*export\s+default\s+function\s+(\w+)/gm, "function $1")
    .replace(/^\s*export\s+default\s+(\w+)\s*;?\s*$/gm, "")
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, "");
}

export default function PlaygroundReact() {
  const [code, setCode] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) return JSON.parse(saved).code || DEFAULT_JSX;
    } catch {}
    return DEFAULT_JSX;
  });
  const [css, setCss] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) return JSON.parse(saved).css || "";
    } catch {}
    return "";
  });
  const [title, setTitle] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) return JSON.parse(saved).title || "Sem título";
    } catch {}
    return "Sem título";
  });
  const [activeTab, setActiveTab] = useState<"jsx" | "css">("jsx");
  const [autoRun, setAutoRun] = useState(true);
  const [savedDialogOpen, setSavedDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const prevBlobUrl = useRef<string | null>(null);
  const { toast } = useToast();

  // Autosave to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ code, css, title }));
    } catch {}
  }, [code, css, title]);

  const buildDocument = useCallback(() => {
    const processedJsx = preprocessJSX(code);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>
*{box-sizing:border-box;} body{margin:0;font-family:sans-serif;}
${css}
</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
const { useState, useEffect, useRef, useCallback, useMemo, useContext, createContext, Fragment } = React;
${processedJsx}
try {
  const _root = ReactDOM.createRoot(document.getElementById('root'));
  _root.render(<App />);
} catch(e) {
  document.getElementById('root').innerHTML =
    '<div style="color:red;padding:20px;font-family:monospace;white-space:pre-wrap">'+
    'Erro ao montar: ' + e.message + '\\n\\nCertifique-se de ter um componente chamado App</div>';
}
</script>
</body></html>`;
  }, [code, css]);

  const updatePreview = useCallback(() => {
    if (!iframeRef.current) return;
    if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    const doc = buildDocument();
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    prevBlobUrl.current = blobUrl;
    iframeRef.current.src = blobUrl;
  }, [buildDocument]);

  useEffect(() => {
    if (autoRun) {
      const timer = setTimeout(updatePreview, 800);
      return () => clearTimeout(timer);
    }
  }, [code, css, autoRun, updatePreview]);

  useEffect(() => { updatePreview(); }, []);

  const savedSnippets = useQuery<Snippet[]>({
    queryKey: ["/api/snippets"],
  });

  const saveSnippetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/snippets", {
        title,
        html: code,
        css,
        js: "",
        mode: "react",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/snippets"] });
      toast({ title: "Salvo!", description: "Componente React salvo no banco de dados." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao salvar.", variant: "destructive" });
    },
  });

  const deleteSnippetMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/snippets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/snippets"] });
      toast({ title: "Removido", description: "Código removido." });
    },
  });

  const renameSnippetMutation = useMutation({
    mutationFn: async ({ id, newTitle }: { id: string; newTitle: string }) => {
      const res = await apiRequest("PATCH", `/api/snippets/${id}`, { title: newTitle });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/snippets"] });
      setRenamingId(null);
      toast({ title: "Renomeado!", description: "Nome atualizado." });
    },
  });

  const loadSnippet = (snippet: Snippet) => {
    setTitle(snippet.title);
    setCode(snippet.html || DEFAULT_JSX);
    setCss(snippet.css || "");
    setSavedDialogOpen(false);
    toast({ title: "Carregado!", description: `"${snippet.title}" aberto.` });
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, "_") || "componente"}.jsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Download iniciado!" });
  };

  const reactSnippets = (savedSnippets.data ?? []).filter((s) => s.mode === "react");
  const filteredSnippets = reactSnippets.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b bg-card flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <Gavel className="h-4 w-4" />
              <span className="hidden sm:inline">Assistente</span>
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Atom className="h-5 w-5 text-blue-500" />
            <span className="font-semibold text-sm">React Playground</span>
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-7 text-sm w-40 sm:w-52"
            placeholder="Nome do componente"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={updatePreview} size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-white">
            <Play className="h-4 w-4" />
            <span className="hidden sm:inline">Executar</span>
          </Button>
          <Button
            onClick={() => setAutoRun((v) => !v)}
            size="sm"
            variant={autoRun ? "default" : "outline"}
            className="gap-1 text-xs"
            title="Auto-executar ao editar"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{autoRun ? "Auto" : "Manual"}</span>
          </Button>
          <Button onClick={() => saveSnippetMutation.mutate()} size="sm" variant="outline" className="gap-1"
            disabled={saveSnippetMutation.isPending}>
            {saveSnippetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span className="hidden sm:inline">Salvar</span>
          </Button>
          <Dialog open={savedDialogOpen} onOpenChange={setSavedDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1">
                <FolderOpen className="h-4 w-4" />
                <span className="hidden sm:inline">Abrir</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Componentes React Salvos</DialogTitle>
              </DialogHeader>
              <div className="relative mb-3">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  className="pl-8"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {savedSnippets.isLoading && <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>}
                {filteredSnippets.length === 0 && !savedSnippets.isLoading && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum componente React salvo.</p>
                )}
                {filteredSnippets.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer group">
                    {renamingId === s.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="h-7 text-sm flex-1"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameSnippetMutation.mutate({ id: s.id, newTitle: renameValue });
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          autoFocus
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => renameSnippetMutation.mutate({ id: s.id, newTitle: renameValue })}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRenamingId(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0" onClick={() => loadSnippet(s)}>
                          <p className="text-sm font-medium truncate">{s.title}</p>
                          <p className="text-xs text-muted-foreground">React/JSX</p>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => { setRenamingId(s.id); setRenameValue(s.title); }}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                            onClick={() => deleteSnippetMutation.mutate(s.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          <Button onClick={handleDownload} size="sm" variant="outline" className="gap-1">
            <Download className="h-4 w-4" />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Editor tabs */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b bg-muted/20 text-xs">
        <button
          onClick={() => setActiveTab("jsx")}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${activeTab === "jsx" ? "bg-blue-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
        >
          JSX / Component
        </button>
        <button
          onClick={() => setActiveTab("css")}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${activeTab === "css" ? "bg-blue-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
        >
          CSS Global
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor */}
        <div className="flex flex-col w-1/2 border-r">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 text-xs text-muted-foreground">
            <Atom className="h-3.5 w-3.5 text-blue-500" />
            <span>{activeTab === "jsx" ? "Componente React (JSX)" : "CSS Global"}</span>
          </div>
          {activeTab === "jsx" ? (
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="flex-1 p-4 font-mono text-sm resize-none bg-background text-foreground focus:outline-none"
              spellCheck={false}
              placeholder="function App() { return <div>Olá React!</div>; }"
              style={{ tabSize: 2 }}
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  e.preventDefault();
                  const start = e.currentTarget.selectionStart;
                  const end = e.currentTarget.selectionEnd;
                  const newValue = code.substring(0, start) + "  " + code.substring(end);
                  setCode(newValue);
                  setTimeout(() => {
                    e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
                  }, 0);
                }
              }}
            />
          ) : (
            <textarea
              value={css}
              onChange={(e) => setCss(e.target.value)}
              className="flex-1 p-4 font-mono text-sm resize-none bg-background text-foreground focus:outline-none"
              spellCheck={false}
              placeholder="/* Estilos globais aqui */"
              style={{ tabSize: 2 }}
            />
          )}
        </div>

        {/* Preview */}
        <div className="flex flex-col w-1/2">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 text-xs text-muted-foreground">
            <Play className="h-3.5 w-3.5 text-blue-500" />
            <span>Preview</span>
            {autoRun && <span className="ml-auto text-xs opacity-60">Auto-atualiza ao editar</span>}
          </div>
          <div className="flex-1 bg-white overflow-hidden">
            <iframe
              ref={iframeRef}
              className="w-full h-full border-none"
              title="React Preview"
              sandbox="allow-scripts"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
