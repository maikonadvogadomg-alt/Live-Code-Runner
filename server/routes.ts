// Cleaned up Python controller usage
// Old controller removed. Using direct TS implementation.
// ============================================================
// MOCK MODE — desativa todas as chamadas de API externas
// Ativa automaticamente se GEMINI_API_KEY não estiver definida
// ou se MOCK_MODE=true estiver no .env
// ============================================================
const MOCK_MODE =
  !process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
  process.env.MOCK_MODE === "true";

if (MOCK_MODE) {
  console.warn(
    "⚠️  [MOCK MODE ATIVO] Chamadas de IA/API externas estão desabilitadas. " +
    "Defina AI_INTEGRATIONS_GEMINI_API_KEY (ou MOCK_MODE=false) para habilitar."
  );
}

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { roboRouter } from "./robo-juridico";
import { insertSnippetSchema, insertCustomActionSchema, insertEmentaSchema, insertAiHistorySchema, insertPromptTemplateSchema, insertDocTemplateSchema } from "@shared/schema";
import { GoogleGenAI } from "@google/genai";

import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { Document, Paragraph, TextRun, Packer, AlignmentType } from "docx";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import jwt from "jsonwebtoken";

const execFileAsync = promisify(execFile);

import { decode } from "html-entities";

function cleanPemKey(raw: string): string {
  const beginIdx = raw.indexOf("-----BEGIN");
  if (beginIdx === -1) return raw;
  const endMarkerMatch = raw.match(/-----END[^-]*-----/);
  if (!endMarkerMatch) return raw;
  const endIdx = raw.indexOf(endMarkerMatch[0]) + endMarkerMatch[0].length;
  const pemSection = raw.slice(beginIdx, endIdx);
  const headerMatch = pemSection.match(/^(-----BEGIN[^-]*-----)(.+)(-----END[^-]*-----)$/s);
  if (!headerMatch) return pemSection;
  const header = headerMatch[1];
  const body = headerMatch[2].replace(/\s+/g, "");
  const footer = headerMatch[3];
  const lines = body.match(/.{1,64}/g) || [];
  return `${header}\n${lines.join("\n")}\n${footer}`;
}

function cleanHtml(html: string): string {
  // Remove script and style elements and their content
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode HTML entities (like &nbsp;, &lt;, etc.)
  text = decode(text);
  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function requireAuth(req: any, res: any, next: any) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return next();
  }
  if (req.session?.authenticated) {
    return next();
  }
  return res.status(401).json({ message: "Não autorizado" });
}

// Inicializa a API do Google Generative AI (Gemini)
// Em mock mode, usamos uma chave placeholder para não quebrar a inicialização,
// mas as chamadas reais serão interceptadas pelo MOCK_MODE guard.
const gemini = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "mock-key-placeholder",
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

async function geminiStream(
  res: any,
  systemPrompt: string,
  userContent: string,
  model: string,
  maxOutputTokens: number
) {
  // ── MOCK MODE GUARD ──────────────────────────────────────────
  if (MOCK_MODE) {
    res.write(`data: ${JSON.stringify({ content: "✅ [MOCK MODE] Gemini desabilitado. Defina AI_INTEGRATIONS_GEMINI_API_KEY para usar IA real." })}\n\n`);
    return;
  }
  // ─────────────────────────────────────────────────────────────

  try {
    const response = await gemini.models.generateContentStream({
      model: model,
      contents: [
        {
          role: "user",
          parts: [
            { text: systemPrompt },
            { text: userContent }
          ]
        }
      ],
      config: {
        maxOutputTokens: maxOutputTokens,
        temperature: 0.7,
      },
    });

    for await (const chunk of response.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }
  } catch (error: any) {
    console.error("Gemini stream error:", error);
    res.write(`data: ${JSON.stringify({ error: error.message || "Erro na geracao de texto via IA" })}\n\n`);
  }
}

async function geminiStreamMessages(
  res: any,
  messages: Array<{ role: "user" | "model"; parts: [{ text: string }] }>,
  model: string,
  maxOutputTokens: number
) {
  // ── MOCK MODE GUARD ──────────────────────────────────────────
  if (MOCK_MODE) {
    res.write(`data: ${JSON.stringify({ content: "✅ [MOCK MODE] Gemini desabilitado. Defina AI_INTEGRATIONS_GEMINI_API_KEY para usar IA real." })}\n\n`);
    return;
  }
  // ─────────────────────────────────────────────────────────────

  try {
    const response = await gemini.models.generateContentStream({
      model: model,
      contents: messages,
      config: {
        maxOutputTokens: maxOutputTokens,
        temperature: 0.7,
      },
    });

    for await (const chunk of response.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }
  } catch (error: any) {
    console.error("Gemini stream messages error:", error);
    res.write(`data: ${JSON.stringify({ error: error.message || "Erro na geracao de texto via IA" })}\n\n`);
  }
}

const SYSTEM_PROMPT_BASE = `Voce e uma assistente juridica especializada. Seu UNICO papel e construir documentos juridicos brasileiros de alta qualidade.
NAO responda como chat generico. NAO de conselhos de vida. Fale APENAS sobre o documento solicitado.
Use linguagem juridica formal, culta e precisa. Cite leis (CF/88, CC, CPC, CLT, etc) e jurisprudencia quando pertinente.
Formate o texto de forma limpa e profissional.

REGRAS:
1. Documento INTEIRO - nunca resuma ou omita. Advogado copia e cola direto.
2. Tom PROFISSIONAL, linguagem juridica formal. Fundamente com legislacao.
3. Base-se EXCLUSIVAMENTE no texto fornecido. Nao invente fatos/dados. Se faltar info: [CAMPO A PREENCHER: descricao]. Se ha ementas selecionadas, CITE-AS.
4. MANTENHA todos nomes, CPFs, numeros, dados pessoais EXATAMENTE como estao. NAO censure.
5. DESENVOLVA argumentos. Mais conteudo e melhor que menos.
6. Texto puro SEM markdown, sem asteriscos, sem hashtags. MAIUSCULAS para titulos. Paragrafos separados por linhas em branco.`;

const ACTION_PROMPTS: Record<string, string> = {
  resumir: "Elabore RESUMO ESTRUTURADO do documento com as seguintes secoes, CADA UMA em bloco separado por linha em branco:\n\n1. NATUREZA DA DEMANDA\n[descricao]\n\n2. FATOS PRINCIPAIS\n[datas, nomes, valores]\n\n3. FUNDAMENTOS JURIDICOS\n[bases legais e argumentos]\n\n4. CONCLUSAO E PEDIDO\n[resultado pretendido]\n\nNao omita detalhes. Cada topico deve iniciar em nova linha apos linha em branco.\n\nDOCUMENTO:\n{{textos}}",
  revisar: "Analise erros gramaticais, concordancia, logica juridica. Sugira melhorias de redacao. Aponte omissoes/contradicoes.\n\nTEXTO:\n{{textos}}",
  refinar: "Reescreva elevando linguagem para padrao de tribunais superiores. Melhore fluidez e vocabulario juridico.\n\nTEXTO:\n{{textos}}",
  simplificar: "Traduza para linguagem simples e acessivel, mantendo rigor tecnico. Cliente leigo deve entender.\n\nTEXTO:\n{{textos}}",
  minuta: "Elabore MINUTA COMPLETA: Enderecamento, Qualificacao, Fatos, Direito e Pedido. Fundamentacao juridica robusta.\n\nINFORMACOES:\n{{textos}}",
  analisar: "Elabore ANALISE JURIDICA com as seguintes secoes, CADA UMA separada por linha em branco:\n\n1. RISCOS PROCESSUAIS\n[analise dos riscos]\n\n2. TESES FAVORAVEIS E CONTRARIAS\n[argumentos pro e contra]\n\n3. JURISPRUDENCIA APLICAVEL\n[precedentes relevantes]\n\n4. PROXIMOS PASSOS\n[recomendacoes de atuacao]\n\nCada secao deve iniciar em nova linha apos linha em branco.\n\nDOCUMENTO:\n{{textos}}",
  "modo-estrito": "Corrija APENAS erros gramaticais e de estilo. Nao altere estrutura ou conteudo.\n\nTEXTO:\n{{textos}}",
  "modo-redacao": "Melhore o texto tornando-o mais profissional e persuasivo, mantendo todos dados e fatos.\n\nTEXTO:\n{{textos}}",
  "modo-interativo": "Identifique lacunas e pontos que precisam complementacao pelo advogado.\n\nTEXTO:\n{{textos}}",
};

async function seedData() {
  const existing = await storage.getSnippets();
  if (existing.length > 0) return;

  await storage.createSnippet({
    title: "Cartao de Perfil",
    html: `<div class="profile-card">\n  <div class="avatar">JD</div>\n  <h2>Joao da Silva</h2>\n  <p class="role">Desenvolvedor Frontend</p>\n  <div class="stats">\n    <div><strong>142</strong><span>Projetos</span></div>\n    <div><strong>1.2k</strong><span>Seguidores</span></div>\n    <div><strong>89</strong><span>Repos</span></div>\n  </div>\n  <button onclick="this.textContent='Seguindo!'">Seguir</button>\n</div>`,
    css: `* { margin:0; padding:0; box-sizing:border-box; }\nbody { font-family:'Segoe UI',sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; background:#0f172a; }\n.profile-card { background:#1e293b; border-radius:16px; padding:2rem; text-align:center; color:#e2e8f0; width:320px; box-shadow:0 25px 50px rgba(0,0,0,0.3); }\n.avatar { width:80px; height:80px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); display:flex; align-items:center; justify-content:center; margin:0 auto 1rem; font-size:1.5rem; font-weight:700; }\nh2 { font-size:1.3rem; margin-bottom:0.3rem; }\n.role { color:#94a3b8; font-size:0.9rem; margin-bottom:1.5rem; }\n.stats { display:flex; justify-content:space-around; margin-bottom:1.5rem; }\n.stats div { display:flex; flex-direction:column; }\n.stats strong { font-size:1.2rem; }\n.stats span { font-size:0.75rem; color:#94a3b8; }\nbutton { width:100%; padding:0.6rem; background:#6366f1; color:#fff; border:none; border-radius:8px; font-size:0.95rem; cursor:pointer; transition:background 0.2s; }\nbutton:hover { background:#4f46e5; }`,
    js: `console.log("Cartao de perfil carregado!");`,
  });

  await storage.createSnippet({
    title: "Contador Animado",
    html: `<div class="counter-app">\n  <h1>Contador</h1>\n  <div class="display" id="count">0</div>\n  <div class="buttons">\n    <button onclick="decrement()">-</button>\n    <button onclick="reset()">Reset</button>\n    <button onclick="increment()">+</button>\n  </div>\n</div>`,
    css: `* { margin:0; padding:0; box-sizing:border-box; }\nbody { font-family:'Segoe UI',sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; background:linear-gradient(135deg,#1a1a2e,#16213e); color:#fff; }\n.counter-app { text-align:center; }\nh1 { font-size:1.5rem; letter-spacing:2px; text-transform:uppercase; opacity:0.7; margin-bottom:1rem; }\n.display { font-size:5rem; font-weight:800; margin:1rem 0; transition:transform 0.15s; }\n.buttons { display:flex; gap:1rem; }\nbutton { padding:0.8rem 1.5rem; font-size:1.2rem; border:none; border-radius:12px; cursor:pointer; font-weight:600; transition:transform 0.1s; }\nbutton:active { transform:scale(0.95); }\nbutton:first-child { background:#ef4444; color:#fff; }\nbutton:nth-child(2) { background:#6b7280; color:#fff; }\nbutton:last-child { background:#22c55e; color:#fff; }`,
    js: `let count = 0;\nconst display = document.getElementById('count');\nfunction increment() { count++; display.textContent = count; display.style.transform='scale(1.1)'; setTimeout(()=>display.style.transform='scale(1)',150); }\nfunction decrement() { count--; display.textContent = count; display.style.transform='scale(0.9)'; setTimeout(()=>display.style.transform='scale(1)',150); }\nfunction reset() { count=0; display.textContent=count; }`,
  });

  await storage.createSnippet({
    title: "Lista de Tarefas",
    html: `<div class="todo-app">\n  <h1>Minhas Tarefas</h1>\n  <div class="input-row">\n    <input type="text" id="taskInput" placeholder="Nova tarefa..." />\n    <button onclick="addTask()">Adicionar</button>\n  </div>\n  <ul id="taskList"></ul>\n</div>`,
    css: `* { margin:0; padding:0; box-sizing:border-box; }\nbody { font-family:'Segoe UI',sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; background:#fafaf9; }\n.todo-app { background:#fff; border-radius:16px; padding:2rem; width:380px; box-shadow:0 4px 24px rgba(0,0,0,0.08); }\nh1 { font-size:1.4rem; color:#1c1917; margin-bottom:1.2rem; }\n.input-row { display:flex; gap:0.5rem; margin-bottom:1rem; }\ninput { flex:1; padding:0.6rem 0.8rem; border:1px solid #d6d3d1; border-radius:8px; font-size:0.9rem; outline:none; }\ninput:focus { border-color:#6366f1; box-shadow:0 0 0 3px rgba(99,102,241,0.1); }\nbutton { padding:0.6rem 1rem; background:#6366f1; color:#fff; border:none; border-radius:8px; cursor:pointer; font-size:0.9rem; }\nul { list-style:none; }\nli { display:flex; align-items:center; gap:0.5rem; padding:0.6rem 0; border-bottom:1px solid #f5f5f4; cursor:pointer; }\nli.done span { text-decoration:line-through; color:#a8a29e; }\n.dot { width:8px; height:8px; border-radius:50%; background:#6366f1; flex-shrink:0; }\nli.done .dot { background:#a8a29e; }`,
    js: `function addTask() {\n  const input = document.getElementById('taskInput');\n  const val = input.value.trim();\n  if (!val) return;\n  const li = document.createElement('li');\n  li.innerHTML = '<span class=\"dot\"></span><span>' + val + '</span>';\n  li.onclick = () => li.classList.toggle('done');\n  document.getElementById('taskList').appendChild(li);\n  input.value = '';\n}\ndocument.getElementById('taskInput').addEventListener('keydown', e => { if(e.key==='Enter') addTask(); });`,
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  try {
    await seedData();
  } catch (err: any) {
    console.warn("⚠️  seedData() falhou (banco de dados indisponível?): " + err.message);
  }

  app.get("/sw.js", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.resolve("client/public/sw.js"));
  });

  app.get("/api/auth/check", (req, res) => {
    const appPassword = process.env.APP_PASSWORD;
    if (!appPassword) {
      return res.json({ authenticated: true, passwordRequired: false });
    }
    return res.json({ 
      authenticated: !!req.session?.authenticated, 
      passwordRequired: true 
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const appPassword = process.env.APP_PASSWORD;
    if (!appPassword) {
      return res.json({ success: true });
    }
    const { password } = req.body;
    if (password === appPassword) {
      req.session!.authenticated = true;
      return res.json({ success: true });
    }
    return res.status(401).json({ message: "Senha incorreta" });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session?.destroy(() => {});
    return res.json({ success: true });
  });

  app.get("/parecer/:id", async (req, res) => {
    const data = await storage.getSharedParecer(req.params.id);
    if (!data) return res.status(404).send("<html><body><h1>Parecer não encontrado ou expirado</h1></body></html>");
    const pageHtml = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Parecer Jurídico</title>
<style>
body{font-family:sans-serif;line-height:1.6;color:#333;max-width:800px;margin:2rem auto;padding:1rem}
header{border-bottom:1px solid #eee;padding-bottom:1rem;margin-bottom:2rem}
h1{font-size:1.5rem;color:#1a1a2e}
.meta{font-size:0.9rem;color:#666;margin-bottom:2rem}
.content{white-space:pre-wrap;font-family:'Times New Roman',serif}
</style>
</head>
<body>
<header>
  <h1>Parecer Jurídico</h1>
  <div class="meta">Gerado em: ${new Date(data.createdAt).toLocaleString('pt-BR')}</div>
</header>
<main class="content">${data.content}</main>
</body>
</html>`;
    res.send(pageHtml);
  });

  app.get("/api/snippets", async (_req, res) => {
    const snippets = await storage.getSnippets();
    res.json(snippets);
  });

  app.get("/api/snippets/:id", async (req, res) => {
    const snippet = await storage.getSnippet(req.params.id);
    if (!snippet) return res.status(404).json({ message: "Snippet não encontrado" });
    res.json(snippet);
  });

  app.post("/api/snippets", async (req, res) => {
    const parsed = insertSnippetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    const snippet = await storage.createSnippet(parsed.data);
    res.status(201).json(snippet);
  });

  app.delete("/api/snippets/:id", async (req, res) => {
    await storage.deleteSnippet(req.params.id);
    res.status(204).send();
  });

  // Custom Actions (Modelos)
  app.get("/api/custom-actions", async (_req, res) => {
    const actions = await storage.getCustomActions();
    res.json(actions);
  });

  app.post("/api/custom-actions", async (req, res) => {
    const parsed = insertCustomActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    const action = await storage.createCustomAction(parsed.data);
    res.status(201).json(action);
  });

  app.delete("/api/custom-actions/:id", async (req, res) => {
    await storage.deleteCustomAction(req.params.id);
    res.status(204).send();
  });

  // Ementas
  app.get("/api/ementas", async (_req, res) => {
    const ementas = await storage.getEmentas();
    res.json(ementas);
  });

  app.post("/api/ementas", async (req, res) => {
    const parsed = insertEmentaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    const ementa = await storage.createEmenta(parsed.data);
    res.status(201).json(ementa);
  });

  app.delete("/api/ementas/:id", async (req, res) => {
    await storage.deleteEmenta(req.params.id);
    res.status(204).send();
  });

  app.post("/api/jurisprudencia/buscar", async (req, res) => {
    try {
      const { query, tribunal } = req.body;
      if (!query) return res.status(400).json({ message: "Query obrigatória" });

      // MOCK MODE GUARD
      if (MOCK_MODE) {
        return res.json([{
          id: "mock-1",
          tribunal: tribunal || "STJ",
          dataDecisao: "2024-01-01",
          relator: "Ministro Mock",
          orgaoJulgador: "Primeira Turma",
          ementa: "✅ MODO MOCK: API Gemini desabilitada. Defina AI_INTEGRATIONS_GEMINI_API_KEY para busca real.",
          link: "#"
        }]);
      }

      const prompt = `Você é um assistente jurídico que busca jurisprudência.
USUÁRIO PESQUISA: "${query}"
TRIBUNAL PREFERENCIAL: "${tribunal || 'STJ'}"

Retorne 3 jurisprudências REAIS ou SIMULADAS com alta verossimilhança sobre este tema.
Retorne APENAS JSON válido (array de objetos). Formato:
[
  {
    "tribunal": "Sigla",
    "dataDecisao": "DD/MM/AAAA",
    "relator": "Nome",
    "orgaoJulgador": "Turma/Câmara",
    "ementa": "Texto completo da ementa...",
    "link": "Link simulado ou real"
  }
]`;

      const response = await gemini.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      let text = response.response.text();
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const data = JSON.parse(text);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // AI History
  app.get("/api/ai-history", async (_req, res) => {
    const history = await storage.getAiHistory();
    res.json(history);
  });

  app.post("/api/ai-history", async (req, res) => {
    const parsed = insertAiHistorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    const history = await storage.createAiHistory(parsed.data);
    res.status(201).json(history);
  });

  app.delete("/api/ai-history/:id", async (req, res) => {
    await storage.deleteAiHistory(req.params.id);
    res.status(204).send();
  });

  app.delete("/api/ai-history", async (_req, res) => {
    await storage.clearAiHistory();
    res.status(204).send();
  });

  // Prompt Templates
  app.get("/api/prompt-templates", async (_req, res) => {
    const tpls = await storage.getPromptTemplates();
    res.json(tpls);
  });

  app.post("/api/prompt-templates", async (req, res) => {
    const parsed = insertPromptTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    const tpl = await storage.createPromptTemplate(parsed.data);
    res.status(201).json(tpl);
  });

  app.delete("/api/prompt-templates/:id", async (req, res) => {
    await storage.deletePromptTemplate(req.params.id);
    res.status(204).send();
  });

  // Doc Templates
  app.get("/api/doc-templates", async (_req, res) => {
    const tpls = await storage.getDocTemplates();
    res.json(tpls);
  });

  app.post("/api/doc-templates", async (req, res) => {
    const parsed = insertDocTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    const tpl = await storage.createDocTemplate(parsed.data);
    res.status(201).json(tpl);
  });

  app.delete("/api/doc-templates/:id", async (req, res) => {
    await storage.deleteDocTemplate(req.params.id);
    res.status(204).send();
  });

  app.post("/api/doc-templates/upload-docx", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado" });
      const { value } = await mammoth.convertToHtml({ buffer: req.file.buffer });
      res.json({ html: value });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/export/word-with-template", async (req, res) => {
    try {
      const { content, templateId } = req.body;
      const cleanContent = cleanHtml(content);

      if (templateId) {
        // Logica de template (placeholder)
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              children: [new TextRun(cleanContent)],
            }),
          ],
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", "attachment; filename=documento.docx");
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Import URL
  app.post("/api/import/url", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ message: "URL obrigatória" });
      const response = await fetch(url);
      const text = await response.text();
      // Simples extração de body (melhorar com cheerio se necessário)
      const bodyContent = text.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || text;
      const clean = cleanHtml(bodyContent);
      res.json({ text: clean.slice(0, 20000) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Upload e extração de texto
  app.post("/api/upload/extract-text", upload.array("files", 10), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ message: "Nenhum arquivo enviado" });

      let combinedText = "";

      for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase();
        let extractedText = "";

        try {
          if (ext === ".pdf") {
            const data = await pdfParse(file.buffer);
            extractedText = data.text;
          } else if (ext === ".docx") {
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            extractedText = result.value;
          } else if (ext === ".txt" || ext === ".md" || ext === ".csv") {
            extractedText = file.buffer.toString("utf-8");
          } else {
            extractedText = file.buffer.toString("utf-8");
          }
        } catch (err) {
          console.error(`Erro no arquivo ${file.originalname}:`, err);
        }

        combinedText += (combinedText ? "\n\n---\n\n" : "") + extractedText;
      }

      res.json({ text: combinedText });
    } catch (error) {
      console.error("Erro na extracao:", error);
      res.status(500).json({ message: "Erro ao processar arquivos" });
    }
  });

  app.post("/api/upload/transcribe", upload.array("files", 5), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }

      // ── MOCK MODE GUARD ──────────────────────────────────────────
      if (MOCK_MODE) {
        return res.json({
          mock: true,
          results: files.map(f => ({
            filename: f.originalname,
            text: "✅ [MOCK MODE] Transcrição desabilitada. Defina AI_INTEGRATIONS_OPENAI_API_KEY para transcrever.",
          }))
        });
      }
      // ─────────────────────────────────────────────────────────────
      // Placeholder para implementação real de transcrição
      return res.status(501).json({ message: "Transcrição real não implementada neste endpoint consolidado." });
    } catch (error) {
      res.status(500).json({ message: "Erro ao transcrever arquivo" });
    }
  });

  app.post("/api/ai/process", async (req, res) => {
    try {
      const { text: rawText, action, customActionId, ementaIds, model, effortLevel, verbosity } = req.body;
      if (!rawText || (!action && !customActionId)) {
        return res.status(400).json({ message: "Texto e ação são obrigatórios" });
      }
      const text = rawText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

      const geminiModel = model === "economico" ? "gemini-2.0-flash" : "gemini-2.0-pro-exp-02-05";
      const effort = typeof effortLevel === "number" ? Math.min(5, Math.max(1, effortLevel)) : 3;
      const verb = verbosity === "curta" ? "curta" : "longa";

      let ementasForSystem = "";
      if (ementaIds && Array.isArray(ementaIds) && ementaIds.length > 0) {
        const selectedEmentas = [];
        for (const eid of ementaIds) {
          const em = await storage.getEmenta(eid);
          if (em) selectedEmentas.push(em);
        }
        if (selectedEmentas.length > 0) {
          ementasForSystem = "\n\nJURISPRUDÊNCIA DE REFERÊNCIA:\n" +
            selectedEmentas.map((e, i) => `EMENTA ${i + 1} - ${e.titulo}:\n${e.texto}`).join("\n\n");
        }
      }

      let promptTemplate: string | undefined;

      if (customActionId) {
        const customAction = await storage.getCustomAction(customActionId);
        if (!customAction) {
          return res.status(400).json({ message: "Modelo personalizado nao encontrado" });
        }
        promptTemplate = customAction.prompt + "\n\n{{textos}}";
      } else {
        promptTemplate = ACTION_PROMPTS[action];
      }

      if (!promptTemplate) {
        return res.status(400).json({ message: "Ação inválida" });
      }

      const effortLabels: Record<number, string> = {
        1: "ESFORCO: RAPIDO. Direto e objetivo.",
        2: "ESFORCO: BASICO. Pontos principais.",
        3: "ESFORCO: DETALHADO. Analise completa.",
        4: "ESFORCO: PROFUNDO. Fundamentacao robusta, nuances, legislacao.",
        5: "ESFORCO: EXAUSTIVO. Todos os angulos, teses, jurisprudencia.",
      };
      const verbosityInstr = verb === "curta"
        ? "TAMANHO: CONCISO. Direto ao ponto."
        : "TAMANHO: COMPLETO. Desenvolva cada argumento.";
      const effortVerbosityInstr = `\n\n${effortLabels[effort] || effortLabels[3]}\n${verbosityInstr}`;

      const maxTokens = verb === "curta" ? (effort <= 2 ? 8192 : 16384) : (effort <= 2 ? 16384 : 32768);

      const systemPromptWithEmentas = SYSTEM_PROMPT_BASE + effortVerbosityInstr + ementasForSystem;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const userPrompt = promptTemplate.replace("{{textos}}", text);

      await geminiStream(res, systemPromptWithEmentas, userPrompt, geminiModel, maxTokens);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("AI processing error:", error?.message || error);
      res.status(500).json({ message: "Erro no processamento IA" });
    }
  });

  app.post("/api/ai/refine", async (req, res) => {
    try {
      const { previousResult, instruction, originalText, model, ementaIds, chatHistory, effortLevel, verbosity } = req.body;
      if (!previousResult || !instruction) {
        return res.status(400).json({ message: "Resultado anterior e instrução são obrigatórios" });
      }

      const geminiModel = model === "economico" ? "gemini-2.0-flash" : "gemini-2.0-pro-exp-02-05";
      const effort = typeof effortLevel === "number" ? Math.min(5, Math.max(1, effortLevel)) : 3;
      const verb = verbosity === "curta" ? "curta" : "longa";

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const refineSystemPrompt = `Voce e uma assistente juridica especializada.
Seu papel e ajustar documentos juridicos brasileiros com base nas instrucoes do usuario.
Mantenha dados pessoais inalterados. Use linguagem formal.`;

      const geminiMessages: Array<{ role: "user" | "model"; parts: [{ text: string }] }> = [];

      if (Array.isArray(chatHistory) && chatHistory.length > 0) {
        for (const msg of chatHistory.slice(-6)) {
          geminiMessages.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          });
        }
      }

      // Adiciona o contexto atual
      geminiMessages.push({ role: 'user', parts: [{ text: `DOCUMENTO ATUAL:\n${previousResult}\n\nINSTRUCAO DE AJUSTE:\n${instruction}` }] });

      await geminiStreamMessages(res, geminiMessages, geminiModel, 8192);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("AI refine error:", error?.message || error);
      res.status(500).json({ message: "Erro no refinamento IA" });
    }
  });

  // Robo Juridico routes (migrated to TS router)
  app.use("/api/robo-juridico", requireAuth, roboRouter);

  app.post("/api/export/word", async (req, res) => {
    try {
      const { text, title } = req.body;
      if (!text) {
        return res.status(400).json({ message: "Texto é obrigatório" });
      }

      const paragraphs = text.split(/\n\n+/).filter((p: string) => p.trim());
      const docChildren: Paragraph[] = [];

      if (title) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: title,
                bold: true,
                size: 28,
                font: "Times New Roman",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          })
        );
      }

      for (const para of paragraphs) {
        const lines = para.split('\n');

        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;

          const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
          if (headingMatch) {
            const level = headingMatch[1].length;
            const headingText = headingMatch[2].replace(/\*\*/g, '');
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: headingText.toUpperCase(),
                    bold: true,
                    size: 24, // 12pt
                    font: "Times New Roman",
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 240, after: 120 },
              })
            );
          } else {
            // Paragrafo normal
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: trimmed,
                    size: 24, // 12pt
                    font: "Times New Roman",
                  }),
                ],
                alignment: AlignmentType.JUSTIFIED,
                indent: { firstLine: 567 }, // ~1cm
                spacing: { after: 120 },
              })
            );
          }
        }
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: docChildren,
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", "attachment; filename=documento.docx");
      res.send(buffer);
    } catch (e: any) {
      console.error("Export Word error:", e);
      res.status(500).json({ message: "Erro ao gerar DOCX" });
    }
  });

  app.post("/api/jwt/generate", async (req, res) => {
    try {
      const { privateKey, serviceAccount, client_id, scope, audience } = req.body;
      const formattedKey = cleanPemKey(privateKey);

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: client_id,
        sub: serviceAccount,
        aud: audience || "https://pdpj.cnj.jus.br",
        exp: now + 3600,
        iat: now,
        scope: scope || "*",
      };

      const token = jwt.sign(payload, formattedKey, { algorithm: "RS256" });
      res.json({ token });
    } catch (error: any) {
      res.status(500).json({ message: "Erro ao gerar token: " + error.message });
    }
  });

  app.post("/api/tts", async (req, res) => {
    res.status(501).json({ message: "TTS not implemented in consolidated server" });
  });

  app.get("/api/jwt/status", async (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/processos", requireAuth, async (_req, res) => {
    // Placeholder
    res.json([]);
  });

  app.get("/api/processos/:id", requireAuth, async (req, res) => {
    res.status(404).json({ message: "Not found" });
  });

  app.post("/api/processos", requireAuth, async (req, res) => {
    res.status(201).json({ id: 1 });
  });

  app.delete("/api/processos/:id", requireAuth, async (req, res) => {
    res.status(204).send();
  });

  app.post("/api/datajud/consulta", requireAuth, async (req, res) => {
    res.json({ message: "Consultas DataJud simuladas/não-implementadas" });
  });

  app.post("/api/datajud/consulta-oab", requireAuth, async (req, res) => {
    res.json({ message: "Consulta OAB simulada" });
  });

  app.post("/api/datajud/consulta-cpf", requireAuth, async (req, res) => {
    res.json({ message: "Consulta CPF simulada" });
  });

  app.get("/api/corporativo/advogado/cpf/:cpf", requireAuth, async (req, res) => {
    res.json({ nome: "Advogado Simulado", cpf: req.params.cpf });
  });

  app.get("/api/corporativo/advogado/oab/:uf/:inscricao", requireAuth, async (req, res) => {
    res.json({ nome: "Advogado OAB Simulado", oab: `${req.params.inscricao}/${req.params.uf}` });
  });

  app.get("/api/corporativo/magistrados/:tribunal", requireAuth, async (req, res) => {
    res.json([{ nome: "Magistrado Exemplo", cargo: "Juiz" }]);
  });

  app.get("/api/pdpj/status", requireAuth, (_req, res) => {
    res.json({ status: "offline", message: "PDPJ mock" });
  });

  app.post("/api/pdpj/test-connection", requireAuth, async (req, res) => {
    res.json({ success: true, message: "Conexão PDPJ (Mock) OK" });
  });

  app.post("/api/pdpj/comunicacoes", requireAuth, async (req, res) => {
    res.json([]);
  });

  app.post("/api/pdpj/representados", requireAuth, async (req, res) => {
    res.json([]);
  });

  app.post("/api/pdpj/habilitacao", requireAuth, async (req, res) => {
    res.json({ success: true });
  });

  app.post("/api/pdpj/pessoa", requireAuth, async (req, res) => {
    res.json({ nome: "Pessoa Mock" });
  });

  app.get("/api/datajud/tribunais", requireAuth, (_req, res) => {
    res.json(["STJ", "STF", "TJMG", "TJSP"]);
  });

  app.get("/api/settings/:key", requireAuth, async (req, res) => {
    const val = await storage.getSetting(req.params.key);
    res.json({ value: val });
  });

  app.put("/api/settings/:key", requireAuth, async (req, res) => {
    await storage.updateSetting(req.params.key, req.body.value);
    res.json({ success: true });
  });

  app.get("/api/tramitacao/clientes", requireAuth, async (req, res) => {
    res.json([]);
  });

  app.post("/api/tramitacao/clientes", requireAuth, async (req, res) => {
    res.json({ id: 1 });
  });

  app.get("/api/tramitacao/clientes/:id", requireAuth, async (req, res) => {
    res.status(404).json({ message: "Cliente nao encontrado" });
  });

  app.get("/api/tramitacao/notas", requireAuth, async (req, res) => {
    res.json([]);
  });

  app.post("/api/tramitacao/notas", requireAuth, async (req, res) => {
    res.json({ id: 1 });
  });

  app.delete("/api/tramitacao/notas/:id", requireAuth, async (req, res) => {
    res.status(204).send();
  });

  app.get("/api/tramitacao/usuarios", requireAuth, async (_req, res) => {
    res.json([]);
  });

  app.get("/api/tramitacao/test", requireAuth, async (_req, res) => {
    res.json({ ok: false, message: "Tramitação Mock" });
  });

  app.get("/api/tramitacao/publicacoes", requireAuth, async (_req, res) => {
    res.json({ publicacoes: [] });
  });

  app.post("/api/tramitacao/sync-publicacoes", requireAuth, async (_req, res) => {
    res.json({ publicacoes: [], synced: 0 });
  });

  app.post("/api/code/run", requireAuth, async (req, res) => {
    try {
      const { code, language } = req.body as { code: string; language: string };
      if (!code || !code.trim()) {
        return res.json({ output: "", error: "", executedCode: "" });
      }

      // ── MOCK MODE GUARD ──────────────────────────────────────────
      if (MOCK_MODE) {
        return res.json({
          mock: true,
          output: "✅ [MOCK MODE ATIVO] Execução de código desabilitada. Defina AI_INTEGRATIONS_GEMINI_API_KEY para executar.",
          error: "",
          executedCode: code,
        });
      }
      // ─────────────────────────────────────────────────────────────

      const langLabel = language === "python" ? "Python" : language === "javascript" ? "JavaScript" : language;
      const prompt = `Execute the following ${langLabel} code and return its output. Only run the code, do not explain it.

\`\`\`${language}
${code}
\`\`\``;
      const response = await gemini.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          tools: [{ codeExecution: {} }] as any,
          temperature: 0,
        },
      });
      let output = "";
      let executedCode = "";
      let error = "";
      const candidate = response.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          const p = part as any;
          if (p.codeExecutionResult) {
            const result = p.codeExecutionResult;
            if (result.outcome === "OUTCOME_OK") {
              output = result.output || "(sem saída — use print() para ver resultados)";
            } else {
              error = result.output || "Erro na execução";
            }
          }
          if (p.executableCode) {
            executedCode = p.executableCode.code || "";
          }
          if (p.text && !output && !error) {
            output = p.text;
          }
        }
      }
      res.json({ output, error, executedCode });
    } catch (e: any) {
      console.error("[code/run]", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/previdenciario/extrair", requireAuth, async (req, res) => {
    try {
      const { texto, tipo } = req.body as { texto: string; tipo: "cnis" | "carta" };
      if (!texto || !tipo) return res.status(400).json({ message: "texto e tipo são obrigatórios" });

      // ── MOCK MODE GUARD ──────────────────────────────────────────
      if (MOCK_MODE) {
        return res.json({
          mock: true,
          tipo,
          data: {
            _mockMessage: "✅ [MOCK MODE ATIVO] Extração previdenciária desabilitada. Defina AI_INTEGRATIONS_GEMINI_API_KEY."
          }
        });
      }
      // ─────────────────────────────────────────────────────────────

      const promptCnis = `Você é especialista em documentos previdenciários brasileiros. Analise o texto do CNIS abaixo e retorne APENAS um JSON válido, sem markdown, organizando todo texto adicional.

Formato exato:
{
  "dadosSegurado": { "nit": "", "cpf": "", "nome": "", "nascimento": "", "mae": "" },
  "periodosContribuicao": [
    { "dataInicial": "DD/MM/YYYY", "dataFinal": "DD/MM/YYYY", "descricao": "nome empresa", "naturezaVinculo": "EMPREGADO|CONTRIBUINTE_INDIVIDUAL|BENEFICIO_INCAPACIDADE|NAO_INFORMADO", "contarCarencia": true }
  ],
  "salarios": [
    { "competencia": "MM/YYYY", "valor": 0.00 }
  ]
}

TEXTO DO CNIS:
${texto.slice(0, 12000)}`;

      const promptCarta = `Você é especialista em documentos previdenciários brasileiros. Analise o texto da Carta de Concessão do INSS abaixo e retorne APENAS um JSON válido, sem markdown, sem texto adicional.

Formato exato:
{
  "numeroBeneficio": "",
  "especie": "",
  "codigoEspecie": "",
  "dib": "DD/MM/YYYY",
  "dip": "DD/MM/YYYY",
  "rmi": 0.00,
  "salarioBeneficio": 0.00,
  "coeficiente": "",
  "segurado": { "nome": "", "cpf": "", "nit": "" },
  "tempoContribuicao": "",
  "dataDespacho": "DD/MM/YYYY"
}

TEXTO DA CARTA:
${texto.slice(0, 12000)}`;

      const prompt = tipo === "cnis" ? promptCnis : promptCarta;
      const response = await gemini.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.1 },
      });

      let raw = response.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const data = JSON.parse(raw);
      res.json({ data, tipo });
    } catch (e: any) {
      console.error("[previdenciario/extrair]", e.message);
      res.status(500).json({ message: e.message });
    }
  });


  // ── Conversations / Chat History (persistência do histórico de chat) ─────────
  app.get("/api/conversations", requireAuth, async (_req, res) => {
    try {
      const convs = await storage.getConversations?.() ?? [];
      res.json(convs ?? []);
    } catch (e) {
      res.status(500).json({ message: "Erro ao buscar conversas" });
    }
  });

  app.post("/api/conversations", requireAuth, async (req, res) => {
    try {
      const { title } = req.body;
      const conv = await storage.createConversation?.(title || "Nova conversa");
      res.status(201).json(conv);
    } catch (e) {
      res.status(500).json({ message: "Erro ao criar conversa" });
    }
  });

  app.get("/api/conversations/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const conv = await storage.getConversation?.(id);
      const msgs = await storage.getMessagesByConversation?.(id) ?? [];
      res.json({ ...conv, messages: msgs });
    } catch (e) {
      res.status(500).json({ message: "Erro ao buscar conversa" });
    }
  });

  app.post("/api/conversations/:id/messages", requireAuth, async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const { role, content } = req.body;
      const msg = await storage.createMessage?.(conversationId, role || "user", content || "");
      res.status(201).json(msg);
    } catch (e) {
      res.status(500).json({ message: "Erro ao salvar mensagem" });
    }
  });

  app.delete("/api/conversations/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteConversation?.(id);
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ message: "Erro ao excluir conversa" });
    }
  });

  return httpServer;
}