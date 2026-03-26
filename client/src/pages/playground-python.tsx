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
  Terminal,
  Gavel,
  Loader2,
  Search,
  Pencil,
  Check,
  X,
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

const DEFAULT_PYTHON = `# PYTHON NO NAVEGADOR — funciona com biblioteca padrão + numpy/pandas
# Use print() para ver resultados
# NÃO funciona: streamlit, PyPDF2, requests, flask — são pacotes de servidor

# Exemplo: processar texto e montar tabela
texto_bruto = """
João Silva,OAB 12345,São Paulo,Ativo
Maria Souza,OAB 67890,Rio de Janeiro,Ativo
Pedro Lima,OAB 11111,Belo Horizonte,Inativo
"""

print("=== TABELA DE DADOS ===")
print(f"{'Nome':<15} {'OAB':<12} {'Cidade':<20} {'Status'}")
print("-" * 60)

linhas = [l.strip() for l in texto_bruto.strip().split("\\n") if l.strip()]
tabela = []
for linha in linhas:
    cols = [c.strip() for c in linha.split(",")]
    tabela.append(cols)
    print(f"{cols[0]:<15} {cols[1]:<12} {cols[2]:<20} {cols[3]}")

print(f"\\nTotal: {len(tabela)} registros")
print(f"Ativos: {sum(1 for r in tabela if r[3] == 'Ativo')}")
`;

const AUTOSAVE_KEY = "python-playground-autosave";

export default function PlaygroundPython() {
  const [code, setCode] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) return JSON.parse(saved).code || DEFAULT_PYTHON;
    } catch {}
    return DEFAULT_PYTHON;
  });
  const [title, setTitle] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) return JSON.parse(saved).title || "Sem título";
    } catch {}
    return "Sem título";
  });
  const [codeOutput, setCodeOutput] = useState<string>("");
  const [codeError, setCodeError] = useState<string>("");
  const [codeRunning, setCodeRunning] = useState(false);
  const [savedDialogOpen, setSavedDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();

  // Autosave to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ code, title }));
    } catch {}
  }, [code, title]);

  const buildPythonDocument = useCallback(() => {
    const escaped = code
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$/g, "\\$");
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { margin:0; background:#0f172a; color:#e2e8f0; font-family:'Consolas','Courier New',monospace; }
  #output { padding:20px; white-space:pre-wrap; font-size:13px; line-height:1.6; min-height:100vh; }
  .info { color:#60a5fa; }
  .ok { color:#4ade80; font-size:11px; }
  .err { color:#f87171; }
</style>
</head>
<body>
<div id="output"><span class="info">⟳ Carregando Python WebAssembly...
(apenas na 1ª vez — depois fica no cache do navegador)</span></div>
<script src="https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js"></script>
<script>
const CODE = \`${escaped}\`;
async function run(){
  const out = document.getElementById('output');
  try {
    const pyodide = await loadPyodide();
    out.innerHTML = '<span class="ok">✓ Python pronto</span>\\n';
    pyodide.runPython(\`
import sys, io
_buf_out = io.StringIO()
_buf_err = io.StringIO()
sys.stdout = _buf_out
sys.stderr = _buf_err
\`);
    try { pyodide.runPython(CODE); } catch(e) {
      out.innerHTML += '<span class="err">Erro Python: ' + e.message + '</span>\\n';
    }
    const stdout = pyodide.runPython('_buf_out.getvalue()');
    const stderr = pyodide.runPython('_buf_err.getvalue()');
    if (stdout) out.innerHTML += stdout;
    if (stderr) out.innerHTML += '<span class="err">[stderr]\\n' + stderr + '</span>';
    if (!stdout && !stderr) out.innerHTML += '<span class="info">(sem saída — use print() para mostrar resultados)</span>';
  } catch(e) {
    out.innerHTML = '<span class="err">Falha ao carregar Pyodide: ' + e.message + '</span>';
  }
}
run();
</script>
</body></html>`;
  }, [code]);

  const updatePreview = useCallback(() => {
    if (!iframeRef.current) return;
    const doc = buildPythonDocument();
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    iframeRef.current.src = blobUrl;
  }, [buildPythonDocument]);

  const handleRun = () => {
    updatePreview();
    toast({ title: "Executando Python...", description: "Aguarde o carregamento do Pyodide." });
  };

  const savedSnippets = useQuery<Snippet[]>({
    queryKey: ["/api/snippets"],
  });

  const saveSnippetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/snippets", {
        title,
        html: code,
        css: "",
        js: "",
        mode: "python",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/snippets"] });
      toast({ title: "Salvo!", description: "Código Python salvo no banco de dados." });
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
    setCode(snippet.html || DEFAULT_PYTHON);
    setSavedDialogOpen(false);
    toast({ title: "Carregado!", description: `"${snippet.title}" aberto.` });
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, "_") || "codigo"}.py`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Download iniciado!" });
  };

  const pythonSnippets = (savedSnippets.data ?? []).filter(
    (s) => s.mode === "python" || (s.mode === "html" && s.html?.includes("def "))
  );
  const filteredSnippets = pythonSnippets.filter((s) =>
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
            <Terminal className="h-5 w-5 text-green-500" />
            <span className="font-semibold text-sm">Python Playground</span>
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-7 text-sm w-40 sm:w-52"
            placeholder="Nome do código"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleRun} size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white">
            <Play className="h-4 w-4" />
            <span className="hidden sm:inline">Executar</span>
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
                <DialogTitle>Códigos Python Salvos</DialogTitle>
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
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum código Python salvo.</p>
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
                          <p className="text-xs text-muted-foreground">Python</p>
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

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor */}
        <div className="flex flex-col w-1/2 border-r">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 text-xs text-muted-foreground">
            <Terminal className="h-3.5 w-3.5 text-green-500" />
            <span>Editor Python</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="flex-1 p-4 font-mono text-sm resize-none bg-background text-foreground focus:outline-none"
            spellCheck={false}
            placeholder="Escreva seu código Python aqui..."
            style={{ tabSize: 4 }}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                const start = e.currentTarget.selectionStart;
                const end = e.currentTarget.selectionEnd;
                const newValue = code.substring(0, start) + "    " + code.substring(end);
                setCode(newValue);
                setTimeout(() => {
                  e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 4;
                }, 0);
              }
            }}
          />
        </div>
  const exportTxt = () => download("filtrado.txt", outText);
  const exportJson = () => download("filtrado.json", JSON.stringify({ createdAt: new Date().toISOString(), output: outText, stats }, null, 2), "application/json");
  const exportMarkdown = () => download("filtrado.md", outText, "text/markdown;charset=utf-8");
  const exportWord = () => {
    const paragraphs = outText.split(/\n\n+/);
    let body = "";
    for (const p of paragraphs) {
      if (!p.trim()) continue;
      const safe = escapeHtml(p.trim());
      body += `<p style="font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;margin-bottom:12pt;">${safe}</p>`;
    }
    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'></head><body>${body}</body></html>`;
    download("filtrado.doc", html, "application/msword");
  };
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(outText);
      toast({ title: "Texto copiado!", description: "Pode colar no Word (Ctrl+V)" });
    } catch {
      toast({ title: "Erro ao copiar", variant: "destructive" });
    }
  };
  const exportRemovedTxt = () => download("removidos.txt", removed.map((r, i) => `${i + 1}. [${r.motivo}]\n${r.texto}`).join("\n\n"));
  const exportRemovedJson = () => download("removidos.json", JSON.stringify(removed, null, 2), "application/json");

        {/* Preview / Output */}
        <div className="flex flex-col w-1/2">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 text-xs text-muted-foreground">
            <Play className="h-3.5 w-3.5 text-green-500" />
            <span>Saída</span>
            <span className="ml-auto text-xs opacity-60">Clique em Executar para rodar</span>
          </div>
          <div className="flex-1 bg-slate-900 overflow-hidden">
            <iframe
              ref={iframeRef}
              className="w-full h-full border-none"
              title="Python Output"
              sandbox="allow-scripts"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
