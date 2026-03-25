import { RoboJuridicoController } from "./robo_juridico_controller";
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
    res.write(`data: ${JSON.stringify({ content: "✅ [MOCK MODE] Gemini desabilitado. Defina AI_INTEGRATIONS_GEMINI_API_KEY para usar IA real." })}

`);
    return;
  }
  // ─────────────────────────────────────────────────────────────
  const fullPrompt = `${systemPrompt}\n\n${userContent}`;
  const stream = await gemini.models.generateContentStream({
    model,
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    config: { maxOutputTokens, temperature: 0.7 },
  });
  for await (const chunk of stream) {
    const content = chunk.text || "";
    if (content) {
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
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
    res.write(`data: ${JSON.stringify({ content: "✅ [MOCK MODE] Gemini desabilitado. Defina AI_INTEGRATIONS_GEMINI_API_KEY para usar IA real." })}

`);
    return;
  }
  // ─────────────────────────────────────────────────────────────
  const stream = await gemini.models.generateContentStream({
    model,
    contents: messages,
    config: { maxOutputTokens, temperature: 0.7 },
  });
  for await (const chunk of stream) {
    const content = chunk.text || "";
    if (content) {
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
  }
}

const SYSTEM_PROMPT_BASE = `Assistente juridica especializada em Direito brasileiro. Produza documentos COMPLETOS e PRONTOS PARA USO.

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
<title>Parecer de Auditoria Financeira${data.processo ? " - " + data.processo : ""}</title>
<style>
body{margin:0;padding:20px;background:#e5e7eb;font-family:system-ui}
.paper{max-width:900px;margin:0 auto;background:#fff;border-radius:12px;padding:20px 24px;box-shadow:0 8px 24px rgba(0,0,0,.12);font-family:'Times New Roman',Georgia,serif;font-size:13px;line-height:1.5;color:#1a1a1a}
.paper .title{text-align:center;font-size:16px;font-weight:bold;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px}
.paper .subtitle{text-align:center;font-size:12px;color:#555;margin-bottom:16px}
.paper .section{margin:16px 0 8px;font-size:14px;font-weight:bold;border-bottom:2px solid #1a1a1a;padding-bottom:4px}
.paper .subsection{margin:10px 0 6px;font-size:13px;font-weight:bold}
.quad{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0}
.quad-box{border:2px solid #d1d5db;border-radius:10px;padding:14px;text-align:center}
.quad-box.a{border-color:#ef4444;background:#fef2f2}
.quad-box.b{border-color:#10b981;background:#f0fdf4}
.quad-box .lbl{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.quad-box .val{font-size:22px;font-weight:900}
.quad-box.a .val{color:#dc2626}
.quad-box.b .val{color:#059669}
.proveito{text-align:center;margin:12px 0;padding:12px;background:#eff6ff;border:2px solid #3b82f6;border-radius:10px}
.proveito .lbl{font-size:11px;color:#666;text-transform:uppercase}
.proveito .val{font-size:20px;font-weight:900;color:#1d4ed8}
.honorarios{text-align:center;margin:8px 0;padding:10px;background:#fefce8;border:2px solid #eab308;border-radius:10px}
.honorarios .lbl{font-size:11px;color:#666;text-transform:uppercase}
.honorarios .val{font-size:18px;font-weight:900;color:#a16207}
.total-geral{text-align:center;margin:8px 0 16px;padding:12px;background:#f0fdf4;border:2px solid #059669;border-radius:10px}
.total-geral .lbl{font-size:11px;color:#666;text-transform:uppercase}
.total-geral .val{font-size:18px;font-weight:900;color:#059669}
.criterios-box{background:#fffdf0;border:1px solid #ccc;padding:15px;margin:10px 0;font-size:11pt;text-align:justify;line-height:1.5}
table.mem{border-collapse:collapse;width:100%;font-size:10px;margin:8px 0;font-family:ui-monospace,monospace}
table.mem th,table.mem td{border:1px solid #d1d5db;padding:4px 6px;text-align:right}
table.mem th{background:#f1f5f9;font-weight:800;text-align:center;font-size:9px;text-transform:uppercase}
table.mem td:first-child{text-align:center;font-weight:600}
table.mem tr:nth-child(even){background:#f8fafc}
table.mem tr.cap{background:#dbeafe !important;font-weight:700}
.assinatura{text-align:center;margin-top:30px;padding-top:10px}
.assinatura .linha{width:300px;border-top:1px solid #1a1a1a;margin:0 auto 6px;padding-top:6px}
.assinatura .nome{font-weight:bold;font-size:13px}
.assinatura .oab{font-size:11px;color:#555}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;font-family:system-ui}
.topbar button{border:0;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;background:#3b82f6;color:#fff;font-size:12px}
.topbar button:hover{opacity:.9}
@media print{.topbar{display:none!important}}
@media(max-width:700px){.quad{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="topbar"><span style="font-size:13px;font-weight:700">Parecer de Auditoria Financeira</span><button onclick="window.print()">Imprimir PDF</button></div>
<div class="paper">${data.html}</div>
</body>
</html>`;
    res.send(pageHtml);
  });

  app.get("/api/tjmg/fatores", async (req, res) => {
    try {
      const startYear = parseInt(req.query.startYear as string) || 2017;
      const endYear = parseInt(req.query.endYear as string) || new Date().getFullYear();

      const response = await fetch("https://www.debit.com.br/tabelas/tribunal-justica-mg", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      });
      if (!response.ok) throw new Error("Erro ao acessar fonte de dados TJMG: HTTP " + response.status);
      const html = await response.text();

      const fatores: Record<string, number> = {};
      const regex = /(\d{2})\/(\d{4})<\/td>\s*<td[^>]*>\s*([\d.,]+)/g;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const mes = match[1];
        const ano = parseInt(match[2]);
        const valor = parseFloat(match[3].replace(/\./g, "").replace(",", "."));
        if (ano >= startYear && ano <= endYear && !isNaN(valor) && valor > 0) {
          fatores[`${ano}-${mes}`] = valor;
        }
      }

      const count = Object.keys(fatores).length;
      if (count === 0) {
        return res.status(404).json({ message: "Nenhum fator TJMG encontrado para o período solicitado." });
      }

      res.json({ fatores, count, startYear, endYear, source: "debit.com.br (dados oficiais TJMG)" });
    } catch (error: any) {
      console.error("TJMG fetch error:", error);
      res.status(500).json({ message: "Erro ao buscar fatores TJMG: " + (error.message || "erro desconhecido") });
    }
  });

  app.post("/api/pdpj/test-connection", async (req, res) => {
    try {
      const { cpf, modo, tribunal, ambiente } = req.body;
      if (!cpf || !tribunal) return res.status(400).json({ message: "CPF e Tribunal sao obrigatorios" });

      const privateKey = cleanPemKey(process.env.PDPJ_PEM_PRIVATE_KEY || "");
      if (!privateKey) return res.status(500).json({ message: "Chave PEM nao configurada no servidor" });

      // Gerar token real para o teste
      const now = Math.floor(Date.now() / 1000);
      const isPjud = modo === "pjud";
      const payload = {
        sub: cpf.replace(/\D/g, ""),
        iss: isPjud ? "pjud" : "pdpj",
        aud: isPjud ? "hc" : "pdpj-docs",
        iat: now,
        exp: now + 3600,
      };

      const token = jwt.sign(payload, privateKey, { algorithm: "RS256" });

      // Endpoint de teste (Domicilio Eletronico - Representados como exemplo de check)
      let baseUrl = ambiente === "producao" 
        ? "https://gateway.cloud.pje.jus.br" 
        : "https://gateway.stg.cloud.pje.jus.br";
      
      // Suporte para Mocks do SwaggerHub
      if (ambiente === "mock1") baseUrl = "https://virtserver.swaggerhub.com/MAIKONMG1_1/CNJ/1.0.0";
      if (ambiente === "mock2") baseUrl = "https://virtserver.swaggerhub.com/MAIKONMG1_12/CNJ/1.0.0";

      const endpoint = (ambiente === "mock1" || ambiente === "mock2") 
        ? "" // Mocks ja incluem o path no baseUrl
        : "/domicilio-eletronico/api/v1/representados";
      
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        const label = response.status === 401 ? "Chave nao autorizada (verifique registro no PDPJ)"
          : response.status === 403 ? "Acesso negado (403) — pode ser restricao de IP do servidor"
          : `Erro HTTP ${response.status}`;
        return res.json({
          connected: false,
          message: `${label}: ${errorText.substring(0, 200)}`,
          http_status: response.status,
          ambiente,
          modo,
          debug_token_payload: payload
        });
      }

      const data = await response.json().catch(() => ({}));
      res.json({ 
        connected: true, 
        message: "Conexao estabelecida com sucesso!",
        ambiente,
        modo,
        data: data,
        debug_token_payload: payload
      });

    } catch (error: any) {
      console.error("PDPJ Connection Test error:", error);
      res.status(500).json({ 
        connected: false, 
        message: "Erro interno: " + error.message,
        ambiente: req.body.ambiente 
      });
    }
  });

  app.get("/api/pdpj/status", (_req, res) => {
    res.json({ configured: !!process.env.PDPJ_PEM_PRIVATE_KEY });
  });

  app.post("/api/pdpj/comunicacoes", async (req, res) => {
    try {
      const { cpf, modo, tribunal, ambiente, dataInicio, dataFim, pagina } = req.body;
      const privateKey = cleanPemKey(process.env.PDPJ_PEM_PRIVATE_KEY || "");
      if (!privateKey) return res.status(500).json({ message: "Chave PEM nao configurada" });

      const now = Math.floor(Date.now() / 1000);
      const isPjud = modo === "pjud";
      const token = jwt.sign({
        sub: cpf.replace(/\D/g, ""),
        iss: isPjud ? "pjud" : "pdpj",
        aud: isPjud ? "hc" : "pdpj-docs",
        iat: now,
        exp: now + 3600,
      }, privateKey, { algorithm: "RS256" });

      const baseUrl = ambiente === "producao" 
        ? "https://gateway.cloud.pje.jus.br" 
        : "https://gateway.stg.cloud.pje.jus.br";
      
      // Ajuste para o endpoint correto de comunicacoes do Domicilio Eletronico
      const url = new URL(`${baseUrl}/domicilio-eletronico/api/v1/comunicacoes`);
      if (dataInicio) url.searchParams.append("dataInicio", dataInicio);
      if (dataFim) url.searchParams.append("dataFim", dataFim);
      url.searchParams.append("pagina", (pagina || 0).toString());
      url.searchParams.append("tamanho", "20");

      const response = await fetch(url.toString(), {
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ message: `Erro PDPJ (${response.status}): ${errText.substring(0, 100)}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/pdpj/representados", async (req, res) => {
    try {
      const { cpf, modo, ambiente } = req.body;
      const privateKey = cleanPemKey(process.env.PDPJ_PEM_PRIVATE_KEY || "");
      if (!privateKey) return res.status(500).json({ message: "Chave PEM nao configurada" });

      const now = Math.floor(Date.now() / 1000);
      const isPjud = modo === "pjud";
      const token = jwt.sign({
        sub: cpf.replace(/\D/g, ""),
        iss: isPjud ? "pjud" : "pdpj",
        aud: isPjud ? "hc" : "pdpj-docs",
        iat: now,
        exp: now + 3600,
      }, privateKey, { algorithm: "RS256" });

      const baseUrl = ambiente === "producao" 
        ? "https://gateway.cloud.pje.jus.br" 
        : "https://gateway.stg.cloud.pje.jus.br";
      
      const response = await fetch(`${baseUrl}/domicilio-eletronico/api/v1/representados`, {
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ message: `Erro PDPJ (${response.status}): ${errText.substring(0, 100)}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/pdpj/habilitacao", async (req, res) => {
    try {
      const { cpf, modo, ambiente, documento } = req.body;
      const privateKey = cleanPemKey(process.env.PDPJ_PEM_PRIVATE_KEY || "");
      const now = Math.floor(Date.now() / 1000);
      const isPjud = modo === "pjud";
      const token = jwt.sign({
        sub: cpf.replace(/\D/g, ""),
        iss: isPjud ? "pjud" : "pdpj",
        aud: isPjud ? "hc" : "pdpj-docs",
        iat: now,
        exp: now + 3600,
      }, privateKey!, { algorithm: "RS256" });

      const baseUrl = ambiente === "producao" 
        ? "https://gateway.cloud.pje.jus.br" 
        : "https://gateway.stg.cloud.pje.jus.br";
      
      const response = await fetch(`${baseUrl}/domicilio-eletronico/api/v1/habilita/verificar/${documento}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/pdpj/pessoa", async (req, res) => {
    try {
      const { cpf, modo, ambiente, documento, tipoPessoa } = req.body;
      const privateKey = cleanPemKey(process.env.PDPJ_PEM_PRIVATE_KEY || "");
      const now = Math.floor(Date.now() / 1000);
      const isPjud = modo === "pjud";
      const token = jwt.sign({
        sub: cpf.replace(/\D/g, ""),
        iss: isPjud ? "pjud" : "pdpj",
        aud: isPjud ? "hc" : "pdpj-docs",
        iat: now,
        exp: now + 3600,
      }, privateKey!, { algorithm: "RS256" });

      const baseUrl = ambiente === "producao" 
        ? "https://gateway.cloud.pje.jus.br" 
        : "https://gateway.stg.cloud.pje.jus.br";
      
      const endpoint = tipoPessoa === "juridica" ? "pessoa-juridica" : "pessoa-fisica";
      const response = await fetch(`${baseUrl}/domicilio-eletronico/api/v1/${endpoint}/${documento}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Webhook público do Tramitação (sem auth — requisição vem de servidor externo) ───
  app.post("/api/webhooks/tramitacao", async (req, res) => {
    try {
      const payload = req.body;
      if (payload?.event_type === "publications.created" && Array.isArray(payload?.payload?.publications)) {
        for (const pub of payload.payload.publications) {
          await storage.upsertTramitacaoPublicacao({
            extId: String(pub.id),
            idempotencyKey: payload.idempotency_key,
            numeroProcesso: pub.numero_processo || "",
            numeroProcessoMascara: pub.numero_processo_com_mascara || "",
            tribunal: pub.siglaTribunal || "",
            orgao: pub.nomeOrgao || "",
            classe: pub.nomeClasse || "",
            texto: pub.texto || "",
            disponibilizacaoDate: pub.disponibilizacao_date || "",
            publicacaoDate: pub.publication_date || "",
            inicioPrazoDate: pub.inicio_do_prazo_date || "",
            linkTramitacao: pub.link_tramitacao || "",
            linkTribunal: pub.link || "",
            destinatarios: JSON.stringify(pub.destinatarios || []),
            advogados: JSON.stringify(pub.destinatario_advogados || []),
          });
        }
      }
      res.json({ ok: true });
    } catch (e: any) {
      console.error("Webhook tramitacao error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  app.use("/api", requireAuth);

  app.post("/api/share/parecer", async (req, res) => {
    try {
      const { html, processo } = req.body;
      if (!html) return res.status(400).json({ message: "HTML do parecer é obrigatório" });
      const sanitized = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/on\w+\s*=\s*"[^"]*"/gi, "").replace(/on\w+\s*=\s*'[^']*'/gi, "");
      const id = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      await storage.createSharedParecer(id, sanitized, processo || "");
      const url = `${req.protocol}://${req.get("host")}/parecer/${id}`;
      res.json({ id, url });
    } catch (error) {
      res.status(500).json({ message: "Erro ao compartilhar parecer" });
    }
  });

  app.get("/api/snippets", async (_req, res) => {
    try {
      const snippets = await storage.getSnippets();
      res.json(snippets);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch snippets" });
    }
  });

  app.get("/api/snippets/:id", async (req, res) => {
    try {
      const snippet = await storage.getSnippet(req.params.id);
      if (!snippet) {
        return res.status(404).json({ message: "Snippet not found" });
      }
      res.json(snippet);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch snippet" });
    }
  });

  app.post("/api/snippets", async (req, res) => {
    try {
      const parsed = insertSnippetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid snippet data" });
      }
      const snippet = await storage.createSnippet(parsed.data);
      res.status(201).json(snippet);
    } catch (error) {
      res.status(500).json({ message: "Failed to create snippet" });
    }
  });

  app.patch("/api/snippets/:id", async (req, res) => {
    try {
      const { title, html, css, js, mode } = req.body;
      const updateData: Partial<{ title: string; html: string; css: string; js: string; mode: string }> = {};
      if (title !== undefined) updateData.title = title;
      if (html !== undefined) updateData.html = html;
      if (css !== undefined) updateData.css = css;
      if (js !== undefined) updateData.js = js;
      if (mode !== undefined) updateData.mode = mode;
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "Nenhum campo para atualizar" });
      }
      const snippet = await storage.updateSnippet(req.params.id, updateData);
      if (!snippet) {
        return res.status(404).json({ message: "Snippet not found" });
      }
      res.json(snippet);
    } catch (error) {
      res.status(500).json({ message: "Failed to update snippet" });
    }
  });

  app.delete("/api/snippets/:id", async (req, res) => {
    try {
      await storage.deleteSnippet(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete snippet" });
    }
  });

  app.get("/api/custom-actions", async (_req, res) => {
    try {
      const actions = await storage.getCustomActions();
      res.json(actions);
    } catch (error) {
      res.status(500).json({ message: "Erro ao buscar modelos" });
    }
  });

  app.post("/api/custom-actions", async (req, res) => {
    try {
      const parsed = insertCustomActionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos" });
      }
      const action = await storage.createCustomAction(parsed.data);
      res.status(201).json(action);
    } catch (error) {
      res.status(500).json({ message: "Erro ao criar modelo" });
    }
  });

  app.patch("/api/custom-actions/:id", async (req, res) => {
    try {
      const parsed = insertCustomActionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos" });
      }
      const action = await storage.updateCustomAction(req.params.id, parsed.data);
      if (!action) {
        return res.status(404).json({ message: "Modelo nao encontrado" });
      }
      res.json(action);
    } catch (error) {
      res.status(500).json({ message: "Erro ao atualizar modelo" });
    }
  });

  app.delete("/api/custom-actions/:id", async (req, res) => {
    try {
      await storage.deleteCustomAction(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Erro ao excluir modelo" });
    }
  });

  app.get("/api/ementas", async (_req, res) => {
    try {
      const items = await storage.getEmentas();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Erro ao buscar ementas" });
    }
  });

  app.post("/api/ementas", async (req, res) => {
    try {
      const parsed = insertEmentaSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos" });
      }
      const ementa = await storage.createEmenta(parsed.data);
      res.status(201).json(ementa);
    } catch (error) {
      res.status(500).json({ message: "Erro ao criar ementa" });
    }
  });

  app.patch("/api/ementas/:id", async (req, res) => {
    try {
      const parsed = insertEmentaSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos" });
      }
      const ementa = await storage.updateEmenta(req.params.id, parsed.data);
      if (!ementa) {
        return res.status(404).json({ message: "Ementa nao encontrada" });
      }
      res.json(ementa);
    } catch (error) {
      res.status(500).json({ message: "Erro ao atualizar ementa" });
    }
  });

  app.delete("/api/ementas/:id", async (req, res) => {
    try {
      await storage.deleteEmenta(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Erro ao excluir ementa" });
    }
  });

  app.post("/api/jurisprudencia/buscar", async (req, res) => {
    try {
      const { q, tribunais } = req.body as { q: string; tribunais: string[] };
      if (!q?.trim()) return res.status(400).json({ message: "Termo de busca obrigatório" });

      // ── MOCK MODE GUARD ──────────────────────────────────────────
      if (MOCK_MODE) {
        return res.json({
          mock: true,
          results: [{
            tribunal: "STJ",
            tipo: "Acórdão",
            processo: "REsp 0000000/SP",
            relator: "[MOCK MODE ATIVO]",
            data: "01/01/2024",
            ementa: "✅ MODO MOCK: API Gemini desabilitada. Defina AI_INTEGRATIONS_GEMINI_API_KEY para busca real.",
            tese: "Mock de jurisprudência — configure a chave da API para resultados reais.",
            fonte: "mock"
          }]
        });
      }
      // ─────────────────────────────────────────────────────────────

      const tribunaisSolicitados = Array.isArray(tribunais) && tribunais.length > 0
        ? tribunais.filter(t => TRIBUNAL_ALIASES[t])
        : ["STJ", "STF", "TRF1", "TRF4"];

      // ── 1. Busca real no DataJud CNJ ────────────────────────────
      // O DataJud indexa processos com campo `ementa` para acórdãos.
      // Tentamos busca multi-match nos campos relevantes de cada tribunal.
      const datajudResults: any[] = [];
      for (const trib of tribunaisSolicitados.slice(0, 4)) {
        const alias = TRIBUNAL_ALIASES[trib];
        if (!alias) continue;
        try {
          const djUrl = `https://api-publica.datajud.cnj.jus.br/${alias}/_search`;
          const djBody = {
            query: {
              bool: {
                should: [
                  { match: { ementa: { query: q, boost: 3 } } },
                  { multi_match: { query: q, fields: ["ementa", "assuntos.nome", "classe.nome"], type: "best_fields" } },
                ],
                minimum_should_match: 1,
                filter: [
                  // Filtra apenas por acórdãos (grau 2 = 2ª instância) quando possível
                  { terms: { "grau": ["G2", "SUP", "JE"] } },
                ],
              },
            },
            size: 5,
            sort: [{ _score: { order: "desc" } }, { "dataHoraUltimaAtualizacao": { order: "desc" } }],
            _source: ["numeroProcesso", "ementa", "classe.nome", "orgaoJulgador.nome", "dataAjuizamento", "assuntos", "grau"],
          };
          const djResp = await fetch(djUrl, {
            method: "POST",
            headers: { "Authorization": `APIKey ${DATAJUD_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(djBody),
            signal: AbortSignal.timeout(8000),
          });
          if (djResp.ok) {
            const djData = await djResp.json();
            const hits = djData?.hits?.hits || [];
            for (const hit of hits) {
              const src = hit._source;
              if (!src.ementa) continue; // ignora processos sem ementa
              datajudResults.push({
                tribunal: trib,
                tipo: src.classe?.nome || "Acórdão",
                processo: src.numeroProcesso || "",
                relator: src.orgaoJulgador?.nome || "",
                data: src.dataAjuizamento ? new Date(src.dataAjuizamento).toLocaleDateString("pt-BR") : "",
                ementa: src.ementa,
                tese: src.assuntos?.map((a: any) => a.nome).join("; ") || "",
                fonte: "datajud",
              });
            }
          }
        } catch (e) {
          // Timeout ou erro de um tribunal não deve interromper os demais
          console.log(`DataJud ${trib} jurisprudência timeout/error:`, (e as any)?.message || e);
        }
      }

      // ── 2. Complementa com IA (Gemini) para enriquecer ou suprir lacunas ──
      const tribunaisComResultado = new Set(datajudResults.map(r => r.tribunal));
      const tribunaisSemDados = tribunaisSolicitados.filter(t => !tribunaisComResultado.has(t));
      const precisaIA = datajudResults.length < 3 || tribunaisSemDados.length > 0;

      let iaResults: any[] = [];
      if (precisaIA) {
        const tribunaisList = tribunaisSemDados.length > 0
          ? tribunaisSemDados.join(", ")
          : (Array.isArray(tribunais) && tribunais.length > 0 ? tribunais.join(", ") : "STJ, STF, TRF1, TRF4");

        const existentesStr = datajudResults.length > 0
          ? `\n\nJá foram encontrados ${datajudResults.length} resultado(s) reais no DataJud nos tribunais: ${[...tribunaisComResultado].join(", ")}. NÃO repita esses tribunais. Foque nos tribunais: ${tribunaisList}.`
          : "";

        const prompt = `Você é um assistente jurídico especializado em jurisprudência brasileira.
Busque jurisprudências REAIS sobre o tema: "${q}"
Tribunais desejados: ${tribunaisList}${existentesStr}

RETORNE EXATAMENTE este JSON (sem markdown, sem explicação extra):
{
  "results": [
    {
      "tribunal": "STJ",
      "tipo": "Acórdão",
      "processo": "REsp 1.234.567/SP",
      "relator": "Min. Nome Completo",
      "data": "DD/MM/AAAA",
      "ementa": "Texto completo da ementa...",
      "tese": "Resumo em 1-2 linhas da tese jurídica",
      "fonte": "ia"
    }
  ]
}

REGRAS OBRIGATÓRIAS:
- Retorne APENAS JSON válido
- Use APENAS jurisprudências reais e verificáveis — nunca invente processos ou datas
- Retorne entre 3 e 6 resultados
- Se não houver jurisprudência real conhecida de um tribunal, não inclua resultados fictícios`;

        try {
          const result = await gemini.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { temperature: 0.1 },
          });
          const raw = result.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(cleaned);
          iaResults = Array.isArray(parsed.results) ? parsed.results : [];
        } catch (iaErr: any) {
          console.error("IA jurisprudência fallback erro:", iaErr.message);
        }
      }

      const allResults = [...datajudResults, ...iaResults];
      res.json({ results: allResults, totalDatajud: datajudResults.length, totalIA: iaResults.length });
    } catch (e: any) {
      console.error("Erro busca jurisprudência:", e.message);
      res.status(500).json({ message: "Erro ao buscar jurisprudências: " + e.message });
    }
  });

  app.get("/api/ai-history", async (_req, res) => {
    try {
      const history = await storage.getAiHistory();
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Erro ao buscar historico" });
    }
  });

  app.post("/api/ai-history", async (req, res) => {
    try {
      const parsed = insertAiHistorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos" });
      }
      const entry = await storage.createAiHistory(parsed.data);
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ message: "Erro ao salvar historico" });
    }
  });

  app.delete("/api/ai-history/:id", async (req, res) => {
    try {
      await storage.deleteAiHistory(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Erro ao excluir historico" });
    }
  });

  app.delete("/api/ai-history", async (_req, res) => {
    try {
      await storage.clearAiHistory();
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Erro ao limpar historico" });
    }
  });

  app.get("/api/prompt-templates", async (_req, res) => {
    try {
      const templates = await storage.getPromptTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Erro ao buscar modelos de prompt" });
    }
  });

  app.post("/api/prompt-templates", async (req, res) => {
    try {
      const parsed = insertPromptTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados invalidos" });
      const template = await storage.createPromptTemplate(parsed.data);
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ message: "Erro ao salvar modelo de prompt" });
    }
  });

  app.patch("/api/prompt-templates/:id", async (req, res) => {
    try {
      const parsed = insertPromptTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados invalidos" });
      const updated = await storage.updatePromptTemplate(req.params.id, parsed.data);
      if (!updated) return res.status(404).json({ message: "Modelo nao encontrado" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Erro ao atualizar modelo de prompt" });
    }
  });

  app.delete("/api/prompt-templates/:id", async (req, res) => {
    try {
      await storage.deletePromptTemplate(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Erro ao excluir modelo de prompt" });
    }
  });

  app.get("/api/doc-templates", async (_req, res) => {
    try {
      const templates = await storage.getDocTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Erro ao buscar templates de documento" });
    }
  });

  app.post("/api/doc-templates", async (req, res) => {
    try {
      const parsed = insertDocTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados invalidos" });
      const template = await storage.createDocTemplate(parsed.data);
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ message: "Erro ao salvar template de documento" });
    }
  });

  app.patch("/api/doc-templates/:id", async (req, res) => {
    try {
      const parsed = insertDocTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados invalidos" });
      const updated = await storage.updateDocTemplate(req.params.id, parsed.data);
      if (!updated) return res.status(404).json({ message: "Template nao encontrado" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Erro ao atualizar template de documento" });
    }
  });

  app.delete("/api/doc-templates/:id", async (req, res) => {
    try {
      await storage.deleteDocTemplate(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Erro ao excluir template de documento" });
    }
  });

  app.post("/api/doc-templates/upload-docx", upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "Nenhum arquivo enviado" });
      const titulo = req.body.titulo || file.originalname.replace(/\.docx$/i, "");
      const categoria = req.body.categoria || "Geral";
      const docxBase64 = file.buffer.toString("base64");

      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file.buffer);
      const docXml = await zip.file("word/document.xml")?.async("string");
      let conteudo = "{{CONTEUDO}}";
      if (docXml) {
        const textContent = docXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const preview = textContent.substring(0, 300);
        conteudo = preview + (textContent.length > 300 ? "..." : "") + "\n\n{{CONTEUDO}}";
      }

      const template = await storage.createDocTemplate({
        titulo,
        categoria,
        conteudo,
        docxBase64,
        docxFilename: file.originalname,
      });
      res.status(201).json(template);
    } catch (error) {
      console.error("Upload docx template error:", error);
      res.status(500).json({ message: "Erro ao importar template Word" });
    }
  });

  app.post("/api/export/word-with-template", async (req, res) => {
    try {
      const { text, title, templateId, html, formatting } = req.body;
      if (!text) return res.status(400).json({ message: "Texto é obrigatório" });

    const fmt = formatting || { fontFamily: "Times New Roman", fontSize: 12, lineHeight: 1.5, textAlign: "justify", paragraphIndent: 4, citationIndent: 4, marginTop: 3, marginBottom: 3, marginLeft: 2, marginRight: 2 };
    if (!fmt.marginTop) fmt.marginTop = 3;
    if (!fmt.marginBottom) fmt.marginBottom = 3;
    if (!fmt.marginLeft) fmt.marginLeft = 2;
    if (!fmt.marginRight) fmt.marginRight = 2;
    if (!fmt.paragraphIndent) fmt.paragraphIndent = 4;
    const pgMarTop = Math.round((fmt.marginTop) * 567);
    const pgMarBottom = Math.round((fmt.marginBottom) * 567);
    const pgMarLeft = Math.round((fmt.marginLeft) * 567);
    const pgMarRight = Math.round((fmt.marginRight) * 567);
    const pgMarXml = `w:top="${pgMarTop}" w:right="${pgMarRight}" w:bottom="${pgMarBottom}" w:left="${pgMarLeft}" w:header="709" w:footer="709" w:gutter="0"`;
    const docTitle = title || "documento";

    const decodeEntities = (s: string): string => s
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
      .replace(/&ordm;/g, 'º').replace(/&ordf;/g, 'ª').replace(/&sect;/g, '§').replace(/&para;/g, '¶')
      .replace(/&Aacute;/g, 'Á').replace(/&aacute;/g, 'á').replace(/&Agrave;/g, 'À').replace(/&agrave;/g, 'à')
      .replace(/&Acirc;/g, 'Â').replace(/&acirc;/g, 'â').replace(/&Atilde;/g, 'Ã').replace(/&atilde;/g, 'ã')
      .replace(/&Eacute;/g, 'É').replace(/&eacute;/g, 'é').replace(/&Egrave;/g, 'È').replace(/&egrave;/g, 'è')
      .replace(/&Ecirc;/g, 'Ê').replace(/&ecirc;/g, 'ê').replace(/&Iacute;/g, 'Í').replace(/&iacute;/g, 'í')
      .replace(/&Ocirc;/g, 'Ô').replace(/&ocirc;/g, 'ô').replace(/&Otilde;/g, 'Õ').replace(/&otilde;/g, 'õ')
      .replace(/&Oacute;/g, 'Ó').replace(/&oacute;/g, 'ó').replace(/&Uacute;/g, 'Ú').replace(/&uacute;/g, 'ú')
      .replace(/&Ccedil;/g, 'Ç').replace(/&ccedil;/g, 'ç').replace(/&Ucirc;/g, 'Û').replace(/&ucirc;/g, 'û')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

    const cleanContent = (c: string) => {
      if (!c) return "";
      return decodeEntities(c)
        .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, "");
    };

    let docxContent = "";
    const docContent = html ? cleanContent(html) : cleanContent(text);

    if (html) {
      const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      const htmlToWordXml = (htmlStr: string): string => {
        // Helper: parse a table HTML element into OOXML <w:tbl>
        const tableToOoxml = (tableHtml: string, fmtFont: string, fmtFontSize: string): string => {
          const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let rowMatch;
          const rows: string[] = [];
          while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
            const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
            let cellMatch;
            const cells: string[] = [];
            while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
              const isHeader = cellMatch[1].toLowerCase() === 'th';
              const cellText = escXml(cellMatch[2].replace(/<[^>]+>/g, '').trim()) || ' ';
              const boldXml = isHeader ? '<w:b/><w:bCs/>' : '';
              const jc = isHeader ? 'center' : 'left';
              cells.push(
                `<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${fmtFont}" w:hAnsi="${fmtFont}"/><w:sz w:val="${fmtFontSize}"/><w:szCs w:val="${fmtFontSize}"/>${boldXml}</w:rPr><w:t xml:space="preserve">${cellText}</w:t></w:r></w:p></w:tc>`
              );
            }
            if (cells.length > 0) rows.push(`<w:tr>${cells.join('')}</w:tr>`);
          }
          if (rows.length === 0) return '';
          return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/></w:tblBorders></w:tblPr>${rows.join('')}</w:tbl>`;
        };

        interface BlockInfo {
          text: string;
          htmlContent: string;
          bold: boolean;
          align: string;
          textIndentCm: number;
          marginLeftCm: number;
          isCitacao: boolean;
          isSmallFont: boolean;
          isSingleSpacing: boolean;
        }

        const fmtFontSize = fmt.fontSize * 2;
        const fmtLineSpacing = String(Math.round(fmt.lineHeight * 240));
        const fmtFont = fmt.fontFamily || "Times New Roman";
        const fmtAlign = fmt.textAlign === "justify" ? "both" : fmt.textAlign || "both";

        // Convert inline HTML (strong/em/u/br) to OOXML runs preserving formatting
        const htmlContentToRuns = (html: string, fontSize: string, defaultBold: boolean): string => {
          const parts: Array<{text: string; bold: boolean; italic: boolean; underline: boolean; br: boolean}> = [];
          const tagPat = /(<br\s*\/?>|<\/?(?:strong|b|em|i|u)[^>]*>|<[^>]+>)/gi;
          let lastIdx = 0;
          let curBold = defaultBold, curItalic = false, curUnder = false;
          let m2: RegExpExecArray | null;
          while ((m2 = tagPat.exec(html)) !== null) {
            if (m2.index > lastIdx) {
              const txt = decodeEntities(html.slice(lastIdx, m2.index));
              if (txt) parts.push({ text: txt, bold: curBold, italic: curItalic, underline: curUnder, br: false });
            }
            const tag2 = m2[0].toLowerCase().replace(/\s+/g, '');
            if (tag2.startsWith('<br')) { parts.push({ text: '', bold: curBold, italic: curItalic, underline: curUnder, br: true }); }
            else if (tag2 === '<strong>' || tag2 === '<b>') curBold = true;
            else if (tag2 === '</strong>' || tag2 === '</b>') curBold = defaultBold;
            else if (tag2 === '<em>' || tag2 === '<i>') curItalic = true;
            else if (tag2 === '</em>' || tag2 === '</i>') curItalic = false;
            else if (tag2 === '<u>') curUnder = true;
            else if (tag2 === '</u>') curUnder = false;
            lastIdx = m2.index + m2[0].length;
          }
          if (lastIdx < html.length) {
            const txt = decodeEntities(html.slice(lastIdx));
            if (txt) parts.push({ text: txt, bold: curBold, italic: curItalic, underline: curUnder, br: false });
          }
          if (parts.length === 0) return '';
          return parts.map(p => {
            if (p.br) return '<w:r><w:br/></w:r>';
            const bx = p.bold ? '<w:b/><w:bCs/>' : '';
            const ix = p.italic ? '<w:i/><w:iCs/>' : '';
            const ux = p.underline ? '<w:u w:val="single"/>' : '';
            return `<w:r><w:rPr><w:rFonts w:ascii="${fmtFont}" w:hAnsi="${fmtFont}"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/>${bx}${ix}${ux}</w:rPr><w:t xml:space="preserve">${escXml(p.text)}</w:t></w:r>`;
          }).join('');
        };

        const parseBlockAttrs = (attrs: string, tag: string, content: string) => {
          const hasBold = /<strong|<b>/i.test(content) || /font-weight:\s*bold/i.test(attrs);
          const plainText = decodeEntities(content.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, "").trim());
          let align = 'both', textIndentCm = 0, marginLeftCm = 0;
          let isCitacao = false, isSmallFont = false, isSingleSpacing = false;
          const sm = attrs.match(/style="([^"]*)"/i);
          const style = sm ? sm[1] : '';
          if (/text-align:\s*center/i.test(style)) align = 'center';
          else if (/text-align:\s*right/i.test(style)) align = 'right';
          else if (/text-align:\s*left/i.test(style)) align = 'left';
          const im = style.match(/text-indent:\s*([\d.]+)cm/i); if (im) textIndentCm = parseFloat(im[1]);
          const mm = style.match(/margin-left:\s*([\d.]+)cm/i); if (mm) marginLeftCm = parseFloat(mm[1]);
          if (marginLeftCm === 0) { const ms = style.match(/(?:^|;)\s*margin:\s*[\d.]+[a-z%]*\s+[\d.]+[a-z%]*\s+[\d.]+[a-z%]*\s+([\d.]+)cm/i); if (ms) marginLeftCm = parseFloat(ms[1]); }
          if (marginLeftCm === 0) { const pl = style.match(/padding-left:\s*([\d.]+)cm/i); if (pl) marginLeftCm = parseFloat(pl[1]); }
          const fs = style.match(/font-size:\s*([\d.]+)pt/i); if (fs && parseFloat(fs[1]) < fmt.fontSize) isSmallFont = true;
          if (/line-height:\s*1[;\s"]/i.test(style) || /line-height:\s*1$/i.test(style)) isSingleSpacing = true;
          if (marginLeftCm >= 2 || /recuo-4cm|citacao/i.test(attrs)) isCitacao = true;
          if (tag.toLowerCase() === 'blockquote') { isCitacao = true; if (marginLeftCm === 0) marginLeftCm = 4; }
          if (tag.toLowerCase().match(/^h[1-6]$/)) { align = align === 'both' ? 'center' : align; }
          return { text: plainText, htmlContent: content, bold: hasBold || /font-weight:\s*bold/i.test(style), align, textIndentCm, marginLeftCm, isCitacao, isSmallFont, isSingleSpacing };
        };

        const blocks: BlockInfo[] = [];
        const tagRegex = /<(p|blockquote|h[1-6]|div)([^>]*)>([\s\S]*?)<\/\1>/gi;
        let match;

        while ((match = tagRegex.exec(htmlStr)) !== null) {
          const [, tag, attrs, content] = match;
          const b = parseBlockAttrs(attrs, tag, content);
          if (!b.text) continue;
          blocks.push(b);
        }

        // Handle <ul>/<ol> list items
        const listRegex = /<(?:ul|ol)[^>]*>([\s\S]*?)<\/(?:ul|ol)>/gi;
        let lm: RegExpExecArray | null;
        while ((lm = listRegex.exec(htmlStr)) !== null) {
          const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
          let li: RegExpExecArray | null;
          while ((li = liRegex.exec(lm[1])) !== null) {
            const liContent = li[1];
            const liText = decodeEntities(liContent.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim());
            if (liText) blocks.push({ text: `• ${liText}`, htmlContent: `• ${liContent}`, bold: false, align: 'both', textIndentCm: 0, marginLeftCm: 1, isCitacao: false, isSmallFont: false, isSingleSpacing: false });
          }
        }

        if (blocks.length === 0 && htmlStr.trim()) {
          const fallbackText = htmlStr.replace(/<[^>]+>/g, "").trim();
          if (fallbackText) {
            blocks.push({ text: fallbackText, htmlContent: fallbackText, bold: false, align: 'both', textIndentCm: 0, marginLeftCm: 0, isCitacao: false, isSmallFont: false, isSingleSpacing: false });
          }
        }

        const blockToOoxml = (b: BlockInfo): string => {
          const indentTwips = Math.round(b.textIndentCm * 567);
          const marginTwips = Math.round(b.marginLeftCm * 567);
          let indentation = '';
          if (indentTwips > 0) indentation = `<w:ind w:firstLine="${indentTwips}"/>`;
          else if (marginTwips > 0) indentation = `<w:ind w:left="${marginTwips}"/>`;

          const fontSize = String(b.isSmallFont ? Math.max(fmtFontSize - 4, 16) : fmtFontSize);
          const spacing = b.isSingleSpacing ? 'line="240" lineRule="auto"' : `line="${fmtLineSpacing}" lineRule="auto"`;
          const jcVal = b.align === 'both' ? fmtAlign : b.align;
          const runs = htmlContentToRuns(b.htmlContent, fontSize, b.bold);
          const safeRuns = runs || `<w:r><w:rPr><w:rFonts w:ascii="${fmtFont}" w:hAnsi="${fmtFont}"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/></w:rPr><w:t xml:space="preserve">${escXml(b.text)}</w:t></w:r>`;
          return `<w:p><w:pPr><w:jc w:val="${jcVal}"/>${indentation}<w:spacing w:after="120" ${spacing}/></w:pPr>${safeRuns}</w:p>`;
        };

        // Process HTML in document order: handle tables inline with paragraphs
        const segments: string[] = [];
        const tableRegex = /<table[\s\S]*?<\/table>/gi;
        let lastIndex = 0;
        let tMatch;
        const parseSection = (html: string): BlockInfo[] => {
          const result2: BlockInfo[] = [];
          const pr = /<(p|blockquote|h[1-6]|div)([^>]*)>([\s\S]*?)<\/\1>/gi;
          let pm;
          while ((pm = pr.exec(html)) !== null) {
            const b = parseBlockAttrs(pm[2], pm[1], pm[3]);
            if (b.text) result2.push(b);
          }
          return result2;
        };

        while ((tMatch = tableRegex.exec(htmlStr)) !== null) {
          const before = htmlStr.slice(lastIndex, tMatch.index);
          if (before.trim()) {
            segments.push(parseSection(before).map(blockToOoxml).join(''));
          }
          segments.push(tableToOoxml(tMatch[0], fmtFont, String(fmtFontSize)));
          lastIndex = tMatch.index + tMatch[0].length;
        }

        // Process remaining HTML after last table (or all HTML if no tables)
        const remaining = lastIndex === 0 ? htmlStr : htmlStr.slice(lastIndex);
        if (remaining.trim() || lastIndex === 0) {
          if (blocks.length > 0 && lastIndex === 0) {
            segments.push(blocks.map(blockToOoxml).join(''));
          } else if (lastIndex > 0 && remaining.trim()) {
            segments.push(parseSection(remaining).map(blockToOoxml).join(''));
          }
        }

        const result = segments.join('');
        if (!result && htmlStr.trim()) {
          const fallbackText = htmlStr.replace(/<[^>]+>/g, '').trim();
          if (fallbackText) return blockToOoxml({ text: fallbackText, htmlContent: fallbackText, bold: false, align: 'both', textIndentCm: 0, marginLeftCm: 0, isCitacao: false, isSmallFont: false, isSingleSpacing: false });
        }
        return result;
      };

      let finalHtml = html;
      if (templateId) {
        const template = await storage.getDocTemplate(templateId);
        if (template && !template.docxBase64) {
          finalHtml = template.conteudo.replace(/\{\{CONTEUDO\}\}/gi, html);
        }
      }
      docxContent = htmlToWordXml(finalHtml);
    } else {
      let finalText = text;
      if (templateId) {
        const template = await storage.getDocTemplate(templateId);
        if (template && !template.docxBase64) {
          finalText = template.conteudo.replace(/\{\{CONTEUDO\}\}/gi, text);
        }
      }

      const cleanText = finalText
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '');

      const fmtFontSizePlain = String(fmt.fontSize * 2);
      const fmtLineSpacingPlain = String(Math.round(fmt.lineHeight * 240));
      const fmtFontPlain = fmt.fontFamily || "Times New Roman";
      const fmtAlignPlain = fmt.textAlign === "justify" ? "both" : fmt.textAlign || "both";
      const fmtIndentPlain = Math.round((fmt.paragraphIndent || 0) * 567);

      const paragraphs = cleanText.split(/\n\n+/).filter((p: string) => p.trim());
      docxContent = paragraphs.map((p: string) => {
        const isTitle = p === p.toUpperCase() && p.length < 200 && p.length > 3;
        const indent = !isTitle && fmtIndentPlain > 0 ? `<w:ind w:firstLine="${fmtIndentPlain}"/>` : '';
        return `<w:p><w:pPr><w:jc w:val="${isTitle ? 'center' : fmtAlignPlain}"/>${indent}<w:spacing w:after="200" w:line="${fmtLineSpacingPlain}" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${fmtFontPlain}" w:hAnsi="${fmtFontPlain}"/><w:sz w:val="${fmtFontSizePlain}"/><w:szCs w:val="${fmtFontSizePlain}"/>${isTitle ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, `</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="${fmtFontPlain}" w:hAnsi="${fmtFontPlain}"/><w:sz w:val="${fmtFontSizePlain}"/><w:szCs w:val="${fmtFontSizePlain}"/></w:rPr><w:br/><w:t xml:space="preserve">`)}</w:t></w:r></w:p>`;
      }).join('');
    }

    const JSZip = (await import("jszip")).default;
    let buffer: Buffer;

    let docxTemplate: { docxBase64: string | null } | null = null;
    if (templateId) {
      const tpl = await storage.getDocTemplate(templateId);
      if (tpl?.docxBase64) docxTemplate = tpl;
    }

    if (docxTemplate?.docxBase64) {
      const tplBuffer = Buffer.from(docxTemplate.docxBase64, "base64");
      const zip = await JSZip.loadAsync(tplBuffer);
      const origDocXml = await zip.file("word/document.xml")?.async("string");
      if (origDocXml) {
        const sectPrMatch = origDocXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
        const sectPr = sectPrMatch ? sectPrMatch[0] : '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';

        const bodyMatch = origDocXml.match(/<w:body>([\s\S]*)<\/w:body>/);
        let beforeContent = "";
        let afterContent = "";
        if (bodyMatch) {
          const bodyInner = bodyMatch[1].replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/, "");
          const allParas = bodyInner.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [];
          let placeholderIdx = -1;
          for (let i = 0; i < allParas.length; i++) {
            const paraText = allParas[i].replace(/<[^>]+>/g, "");
            if (paraText.includes("{{CONTEUDO}}") || paraText.includes("{{ CONTEUDO }}") || paraText.includes("{{conteudo}}")) {
              placeholderIdx = i;
              break;
            }
          }
          if (placeholderIdx >= 0) {
            beforeContent = allParas.slice(0, placeholderIdx).join("");
            afterContent = allParas.slice(placeholderIdx + 1).join("");
          } else {
            beforeContent = allParas.join("");
          }
        }

        const nsMatch = origDocXml.match(/<w:document([^>]*)>/);
        const nsAttrs = nsMatch ? nsMatch[1] : ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
        const newDocXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document${nsAttrs}><w:body>${beforeContent}${docxContent}${afterContent}${sectPr}</w:body></w:document>`;
        zip.file("word/document.xml", newDocXml, { binary: false });
      }
      buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    } else {
      const docxml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mo="http://schemas.microsoft.com/office/mac/office/2008/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:mv="urn:schemas-microsoft-com:mac:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"><w:body>${docxContent}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar ${pgMarXml}/></w:sectPr></w:body></w:document>`;

      const zip = new JSZip();
      zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
      zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
      zip.file("word/document.xml", docxml, { binary: false });
      zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
      buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${docTitle}.docx"`);
    res.send(buffer);
  } catch (error) {
    console.error("Word template export error:", error);
    res.status(500).json({ message: "Erro ao gerar documento Word com template" });
  }
});

  app.post("/api/import/url", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") return res.status(400).json({ message: "URL invalida" });
      let parsedUrl: URL;
      try { parsedUrl = new URL(url); } catch { return res.status(400).json({ message: "URL mal formada" }); }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) return res.status(400).json({ message: "Apenas URLs http/https sao permitidas" });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; LegalAssistant/1.0)" },
        });
      } finally { clearTimeout(timeout); }

      if (!response.ok) return res.status(502).json({ message: `Site retornou erro ${response.status}` });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
        return res.status(415).json({ message: "O link nao aponta para uma pagina de texto legivel" });
      }

      const html = await response.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<header[\s\S]*?<\/header>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0).join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (text.length < 100) return res.status(422).json({ message: "Nao foi possivel extrair texto desta pagina" });
      return res.json({ text: text.substring(0, 80000), length: text.length, url });
    } catch (err: any) {
      if (err?.name === "AbortError") return res.status(504).json({ message: "Tempo limite excedido ao acessar o link" });
      return res.status(500).json({ message: "Erro ao buscar o link" });
    }
  });

  app.post("/api/upload/extract-text", upload.array("files", 10), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }

      let combinedText = "";

      for (const file of files) {
        const ext = file.originalname.toLowerCase().split(".").pop() || "";
        const mime = file.mimetype || "";
        let extractedText = "";

        try {
          const isPdf = ext === "pdf" || mime === "application/pdf";
          const isDocx = ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          const isHtml = ["html", "htm", "xml"].includes(ext) || mime.includes("html") || mime.includes("xml");

          if (isPdf) {
            const pdfData = await pdfParse(file.buffer);
            extractedText = pdfData.text || "";


            const textLength = extractedText.replace(/\s+/g, "").length;
            const fileSizeKB = file.buffer.length / 1024;
            if (textLength < 50 || (fileSizeKB > 100 && textLength < fileSizeKB * 0.5)) {
              const ocrTmpDir = fs.mkdtempSync(path.join("/tmp", "ocr-"));
              try {
                const pdfPath = path.join(ocrTmpDir, "input.pdf");
                fs.writeFileSync(pdfPath, file.buffer);
                await execFileAsync("pdftoppm", ["-png", "-r", "300", pdfPath, path.join(ocrTmpDir, "page")], { timeout: 300000 });
                const pageFiles = fs.readdirSync(ocrTmpDir).filter(f => f.startsWith("page") && f.endsWith(".png")).sort();
                let ocrText = "";
                for (const pageFile of pageFiles) {
                  const { stdout } = await execFileAsync("tesseract", [path.join(ocrTmpDir, pageFile), "stdout", "-l", "por+eng"], { timeout: 60000 });
                  ocrText += stdout + "\n";
                }
                extractedText = ocrText || extractedText;
              } finally {
                fs.rmSync(ocrTmpDir, { recursive: true, force: true });
              }
            }
          } else if (isDocx) {
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            extractedText = result.value;
          } else if (isHtml) {
            extractedText = cleanHtml(file.buffer.toString("utf-8"));
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
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }

      const results: { filename: string; text: string; error?: string }[] = [];
      const tmpDir = fs.mkdtempSync(path.join("/tmp", "transcribe-"));

      for (const file of files) {
        const ext = file.originalname.toLowerCase().split(".").pop() || "";
        const mime = file.mimetype || "";
        const isAudio = ["mp3", "wav", "m4a", "ogg", "oga", "opus", "ptt", "flac", "aac", "wma", "webm"].includes(ext) || mime.startsWith("audio/");
        const isVideo = ["mp4", "mov", "avi", "mkv", "wmv", "flv", "webm", "3gp", "m4v"].includes(ext) || mime.startsWith("video/");
        const needsConversion = ["ogg", "oga", "opus", "ptt", "wma", "webm", "flac", "aac"].includes(ext);

        if (!isAudio && !isVideo) {
          results.push({ filename: file.originalname, text: "", error: "Formato nao suportado. Use audio (MP3, WAV, M4A, OGG, OPUS, PTT) ou video (MP4, MOV, AVI, MKV)." });
          continue;
        }

        if (file.size === 0) {
          results.push({ filename: file.originalname, text: "", error: "Arquivo vazio." });
          continue;
        }

        const safeExt = ext.replace(/[^a-z0-9]/g, "") || "bin";
        const timestamp = Date.now();
        const inputPath = path.join(tmpDir, `input_${timestamp}.${safeExt}`);
        let audioPath = inputPath;

        try {
          fs.writeFileSync(inputPath, file.buffer);

          if (isVideo || needsConversion) {
            audioPath = path.join(tmpDir, `audio_${timestamp}.mp3`);
            try {
              await execFileAsync("ffmpeg", ["-i", inputPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", "-y", audioPath], { timeout: 120000 });
            } catch (ffErr) {
              results.push({ filename: file.originalname, text: "", error: isVideo ? "Erro ao extrair audio do video. Verifique se o arquivo nao esta corrompido." : "Erro ao converter audio. Verifique se o arquivo nao esta corrompido." });
              continue;
            }
          }

          const audioStream = fs.createReadStream(audioPath);

          const transcription = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file: audioStream,
            response_format: "json",
            language: "pt",
          });

          const text = typeof transcription === "string" ? transcription : (transcription as { text: string }).text || "";

          if (!text.trim()) {
            results.push({ filename: file.originalname, text: "", error: "Nao foi possivel transcrever. O audio pode estar sem fala ou muito baixo." });
          } else {
            results.push({ filename: file.originalname, text: text.trim() });
          }
        } finally {
          try { fs.unlinkSync(inputPath); } catch {}
          if (audioPath !== inputPath) {
            try { fs.unlinkSync(audioPath); } catch {}
          }
        }
      }

      try { fs.rmdirSync(tmpDir); } catch {}
      res.json({ results });
    } catch (error) {
      console.error("Transcription error:", error);
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

      const geminiModel = model === "economico" ? "gemini-2.5-flash" : "gemini-2.5-pro";
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
          ementasForSystem = "\n\nJURISPRUDÊNCIA DE REFERÊNCIA SELECIONADA PELO ADVOGADO:\nO advogado selecionou as seguintes ementas/julgados da sua biblioteca pessoal. Você DEVE utilizá-los como fundamentação quando pertinente ao caso. Cite-os explicitamente no texto produzido.\n\n" +
            selectedEmentas.map((e, i) => `EMENTA ${i + 1} [${e.categoria}] - ${e.titulo}:\n${e.texto}`).join("\n\n") +
            "\n\nIMPORTANTE: As ementas acima foram ESCOLHIDAS pelo advogado. USE-AS na fundamentação jurídica do documento. Não as ignore.";
          console.log(`[AI Process] ${selectedEmentas.length} ementa(s) incluída(s) no contexto do sistema`);
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

      const economicoExtra = "";

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

      const systemPromptWithEmentas = SYSTEM_PROMPT_BASE + economicoExtra + effortVerbosityInstr + ementasForSystem;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Gemini 2.5 Flash/Pro suportam até 1 milhão de tokens — processar SEMPRE em chamada única
      // Evita cobranças múltiplas desnecessárias por divisão de documentos
      const MAX_DIRECT_CHARS = 800000; // ~200k tokens — limite seguro para chamada única
      const safeText = text.length > MAX_DIRECT_CHARS
        ? text.substring(0, MAX_DIRECT_CHARS)
        : text;

      const userPrompt = promptTemplate.replace("{{textos}}", safeText);

      console.log(`[AI Process] Model: ${geminiModel}, Action: ${action || 'custom'}, Text: ${text.length} chars, MaxTokens: ${maxTokens}`);

      await geminiStream(res, systemPromptWithEmentas, userPrompt, geminiModel, maxTokens);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("AI processing error:", error?.message || error);
      const errorMsg = error?.status === 429
        ? "Limite de uso atingido. Aguarde alguns segundos e tente novamente."
        : error?.status === 503 || error?.status === 502
        ? "Servidor de IA temporariamente indisponível. Tente novamente em instantes."
        : error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT"
        ? "Conexão com a IA foi interrompida. Tente novamente."
        : `Erro ao processar: ${error?.message || "erro desconhecido"}`;
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: errorMsg });
      }
    }
  });

  app.post("/api/ai/refine", async (req, res) => {
    try {
      const { previousResult, instruction, originalText, model, ementaIds, chatHistory, effortLevel, verbosity } = req.body;
      if (!previousResult || !instruction) {
        return res.status(400).json({ message: "Resultado anterior e instrução são obrigatórios" });
      }

      const geminiModel = model === "economico" ? "gemini-2.5-flash" : "gemini-2.5-pro";
      const effort = typeof effortLevel === "number" ? Math.min(5, Math.max(1, effortLevel)) : 3;
      const verb = verbosity === "curta" ? "curta" : "longa";

      let ementasForRefine = "";
      if (ementaIds && Array.isArray(ementaIds) && ementaIds.length > 0) {
        const selectedEmentas = [];
        for (const eid of ementaIds) {
          const em = await storage.getEmenta(eid);
          if (em) selectedEmentas.push(em);
        }
        if (selectedEmentas.length > 0) {
          ementasForRefine = "\n\nJURISPRUDÊNCIA DE REFERÊNCIA SELECIONADA PELO ADVOGADO:\nO advogado selecionou as seguintes ementas/julgados. Você DEVE utilizá-los quando o advogado pedir para fundamentar, citar jurisprudência, ou quando for pertinente ao ajuste solicitado.\n\n" +
            selectedEmentas.map((e, i) => `EMENTA ${i + 1} [${e.categoria}] - ${e.titulo}:\n${e.texto}`).join("\n\n") +
            "\n\nIMPORTANTE: USE estas ementas na fundamentação quando solicitado. Não as ignore.";
          console.log(`[AI Refine] ${selectedEmentas.length} ementa(s) incluída(s) no contexto do sistema`);
        }
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const historyTurnCount = Array.isArray(chatHistory) ? chatHistory.length : 0;
      console.log(`[AI Refine] Model: ${geminiModel}, Instruction: "${instruction.substring(0, 100)}", Ementas: ${ementasForRefine.length > 0 ? 'YES' : 'NO'}, Chat turns: ${historyTurnCount}`);

      const refineSystemPrompt = `Voce e uma assistente juridica especializada. Seu UNICO papel e construir e ajustar documentos juridicos brasileiros.

REGRA ABSOLUTA: Se a mensagem do advogado NAO for uma instrucao juridica clara (ex: reclamacao, desabafo, frustracao, mensagem generica), IGNORE o conteudo emocional e retorne o documento atual SEM alteracoes. Nunca comente sobre frustracao, custo, dinheiro ou emocoes. Apenas documente.

${originalText ? `TEXTO BASE:\n---\n${originalText.substring(0, 15000)}\n---\n` : ""}${ementasForRefine}

MODOS DE OPERACAO (use apenas quando a instrucao for juridicamente clara):
1. CONSTRUCAO ("faz minuta/peticao/recurso"): Documento INTEIRO com todas as secoes. Cite legislacao. Dado ausente: [CAMPO A PREENCHER].
2. EXPANSAO ("expande/mais detalhes/mais argumentos"): Expanda com mais argumentacao juridica.
3. AJUSTE ("muda/corrige/altera X"): Documento COMPLETO com a alteracao especifica. Nao encurte.
4. PERGUNTA juridica ("o que acha?/qual fundamento?"): Responda diretamente, sem repetir o documento.

REGRAS FIXAS: Mantenha dados pessoais exatos. Texto puro sem markdown. Use historico da conversa. Nao invente fatos. Se instrucao for vaga ou emocional, retorne o documento atual integralmente.`;

      const refineEffortLabels: Record<number, string> = {
        1: "ESFORCO: RAPIDO.",
        2: "ESFORCO: BASICO.",
        3: "ESFORCO: DETALHADO.",
        4: "ESFORCO: PROFUNDO.",
        5: "ESFORCO: EXAUSTIVO.",
      };
      const refineVerbInstr = verb === "curta" ? "Conciso." : "Completo.";
      const refineEffortBlock = `\n\n${refineEffortLabels[effort] || refineEffortLabels[3]}\n${refineVerbInstr}`;
      const refineMaxTokens = verb === "curta" ? (effort <= 2 ? 4096 : 8192) : (effort <= 2 ? 8192 : 16384);
      const fullRefinePrompt = refineSystemPrompt + refineEffortBlock;

      const geminiMessages: Array<{ role: "user" | "model"; parts: [{ text: string }] }> = [];

      if (Array.isArray(chatHistory) && chatHistory.length > 0) {
        const recentHistory = chatHistory.slice(-6);
        let systemInjected = false;
        for (const msg of recentHistory) {
          if (msg.role === 'assistant' || msg.role === 'user') {
            const trimmedContent = msg.content.length > 10000 ? msg.content.substring(0, 10000) + "\n[...texto truncado para economia...]" : msg.content;
            const geminiRole = msg.role === 'assistant' ? 'model' : 'user';
            if (!systemInjected && geminiRole === 'user') {
              geminiMessages.push({ role: 'user', parts: [{ text: `${fullRefinePrompt}\n\n${trimmedContent}` }] });
              systemInjected = true;
            } else {
              geminiMessages.push({ role: geminiRole, parts: [{ text: trimmedContent }] });
            }
          }
        }
        if (!systemInjected) {
          geminiMessages.push({ role: 'user', parts: [{ text: `${fullRefinePrompt}\n\n${instruction}` }] });
        }
      } else {
        geminiMessages.push({ role: 'user', parts: [{ text: `${fullRefinePrompt}\n\nDOCUMENTO ATUAL:\n${previousResult}` }] });
        geminiMessages.push({ role: 'model', parts: [{ text: previousResult }] });
        geminiMessages.push({ role: 'user', parts: [{ text: instruction }] });
      }

      console.log(`[AI Refine] Effort: ${effort}, Verbosity: ${verb}, MaxTokens: ${refineMaxTokens}`);

      await geminiStreamMessages(res, geminiMessages, geminiModel, refineMaxTokens);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("AI refine error:", error?.message || error);
      const errorMsg = error?.status === 429
        ? "Limite de uso atingido. Aguarde alguns segundos e tente novamente."
        : error?.status === 503 || error?.status === 502
        ? "Servidor de IA temporariamente indisponível. Tente novamente em instantes."
        : error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT"
        ? "Conexão com a IA foi interrompida. Tente novamente."
        : `Erro ao processar: ${error?.message || "erro desconhecido"}`;
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: errorMsg });
      }
    }
  });

  function parseInlineRuns(line: string, defaultBold = false): TextRun[] {
        const runs: TextRun[] = [];
        const regex = /\*\*(.+?)\*\*|__(.+?)__|_(.+?)_|\*(.+?)\*/g;
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(line)) !== null) {
          if (match.index > lastIndex) {
            runs.push(new TextRun({
              text: line.slice(lastIndex, match.index),
              size: 24,
              font: "Times New Roman",
              bold: defaultBold,
            }));
          }
          const boldText = match[1] || match[2];
          const italicText = match[3] || match[4];
          if (boldText) {
            runs.push(new TextRun({
              text: boldText,
              bold: true,
              size: 24,
              font: "Times New Roman",
            }));
          } else if (italicText) {
            runs.push(new TextRun({
              text: italicText,
              italics: true,
              size: 24,
              font: "Times New Roman",
              bold: defaultBold,
            }));
          }
          lastIndex = regex.lastIndex;
        }
        if (lastIndex < line.length) {
          runs.push(new TextRun({
            text: line.slice(lastIndex),
            size: 24,
            font: "Times New Roman",
            bold: defaultBold,
          }));
        }
        if (runs.length === 0) {
          runs.push(new TextRun({
            text: line,
            size: 24,
            font: "Times New Roman",
            bold: defaultBold,
          }));
        }
        return runs;
  }

  // Robo Juridico routes
  app.get("/api/robo-juridico/status", requireAuth, async (_req, res) => {
    try {
      const resultado = RoboJuridicoController.obter_status();
      res.json(resultado);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: "Erro ao verificar status do robo juridico: " + error.message,
      });
    }
  });

  app.post("/api/robo-juridico/executar", requireAuth, async (_req, res) => {
    try {
      const resultado = RoboJuridicoController.executar_robo();

      // Persiste um resumo da execução para auditoria e rastreabilidade.
      await storage.createAiHistory({
        action: "robo-juridico",
        inputPreview: "execucao manual via endpoint /api/robo-juridico/executar",
        result: JSON.stringify({
          success: resultado.success,
          message: resultado.data?.message || resultado.error || "",
          statistics: resultado.data?.statistics || {},
          timestamp: resultado.data?.timestamp || new Date().toISOString(),
        }),
      });

      const statusCode = resultado.success ? 200 : 500;
      res.status(statusCode).json(resultado);
    } catch (error: any) {
      console.error("Erro ao executar robo juridico:", error);
      res.status(500).json({
        success: false,
        error: "Erro interno ao executar robo juridico: " + error.message,
      });
    }
  });

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
                    text: headingText,
                    bold: true,
                    size: level <= 2 ? 28 : 24,
                    font: "Times New Roman",
                    allCaps: level <= 2,
                  }),
                ],
                spacing: { before: 360, after: 200 },
                alignment: level <= 2 ? AlignmentType.CENTER : AlignmentType.LEFT,
              })
            );
            continue;
          }

          const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.length < 120 && trimmed.length > 3 && !/^\d/.test(trimmed) && !trimmed.includes('http');
          if (isAllCaps) {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: trimmed.replace(/\*\*/g, ''),
                    bold: true,
                    size: 24,
                    font: "Times New Roman",
                  }),
                ],
                spacing: { before: 360, after: 200 },
                alignment: AlignmentType.JUSTIFIED,
              })
            );
            continue;
          }

          const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
          if (bulletMatch) {
            docChildren.push(
              new Paragraph({
                children: parseInlineRuns(bulletMatch[1]),
                spacing: { after: 80 },
                indent: { left: 720 , hanging: 360 },
                bullet: { level: 0 },
              })
            );
            continue;
          }

          const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
          if (numberedMatch) {
            const numRuns = parseInlineRuns(numberedMatch[2]);
            numRuns.unshift(new TextRun({
              text: numberedMatch[1] + ". ",
              bold: true,
              size: 24,
              font: "Times New Roman",
            }));
            docChildren.push(
              new Paragraph({
                children: numRuns,
                spacing: { after: 120 },
                indent: { left: 720, hanging: 360 },
              })
            );
            continue;
          }

          const letterMatch = trimmed.match(/^([a-z])[.)]\s+(.+)$/);
          if (letterMatch) {
            const letRuns = parseInlineRuns(letterMatch[2]);
            letRuns.unshift(new TextRun({
              text: letterMatch[1] + ") ",
              bold: true,
              size: 24,
              font: "Times New Roman",
            }));
            docChildren.push(
              new Paragraph({
                children: letRuns,
                spacing: { after: 120 },
                indent: { left: 1080, hanging: 360 },
              })
            );
            continue;
          }

          docChildren.push(
            new Paragraph({
              children: parseInlineRuns(trimmed),
              spacing: { after: 200, line: 360 },
              alignment: AlignmentType.JUSTIFIED,
              indent: { firstLine: 2268 },
            })
          );
        }

        docChildren.push(
          new Paragraph({
            children: [],
            spacing: { after: 120 },
          })
        );
      }

      const doc = new Document({
        sections: [{
          properties: {
            page: {
              margin: {
                top: 1701,
                right: 1134,
                bottom: 1134,
                left: 1701,
              },
            },
          },
          children: docChildren,
        }],
      });

      const buffer = await Packer.toBuffer(doc);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${(title || "documento").replace(/[^a-zA-Z0-9\s-]/g, '')}.docx"`);
      res.send(buffer);
    } catch (error) {
      console.error("Word export error:", error);
      res.status(500).json({ message: "Erro ao exportar Word" });
    }
  });

  app.post("/api/jwt/generate", async (req, res) => {
    const pemKey = process.env.PDPJ_PEM_PRIVATE_KEY;
    try {
      if (!pemKey) {
        return res.status(400).json({ 
          message: "Chave PEM nao configurada. Adicione a chave privada PEM nas configuracoes de segredo com o nome PDPJ_PEM_PRIVATE_KEY." 
        });
      }

      const { cpf, tribunal, expiresInMinutes, nome, modo } = req.body;

      if (!cpf || typeof cpf !== "string" || cpf.replace(/\D/g, "").length !== 11) {
        return res.status(400).json({ message: "CPF invalido. Deve ter 11 digitos." });
      }

      const cleanCpf = cpf.replace(/\D/g, "");
      const expMinutes = Math.min(Math.max(parseInt(expiresInMinutes) || 5, 1), 60);
      const validTribunals = ["TJMG","TJSP","TJRJ","TJRS","TJPR","TJSC","TJBA","TJPE","TJCE","TJGO","TJDF","TRT2","TRT3","TRF1","TRF3","CNJ"];
      const selectedTribunal = validTribunals.includes(tribunal) ? tribunal : "TJMG";
      const isPjud = modo === "pjud";

      const now = Math.floor(Date.now() / 1000);
      const payload: Record<string, any> = {
        sub: cleanCpf,
        iss: isPjud ? "https://seu-issuer.example" : "pdpj-br",
        aud: isPjud ? "pjud" : "https://gateway.stg.cloud.pje.jus.br",
        iat: now,
        exp: now + (expMinutes * 60),
        jti: `${isPjud ? "pjud" : "pdpj"}-${Date.now()}`,
        tribunal: selectedTribunal,
        scope: "pdpj.read pdpj.write",
      };
      if (nome && typeof nome === "string" && nome.trim()) {
        payload.name = nome.trim();
      }

      let formattedKey = pemKey;
      if (formattedKey.includes("\\n")) {
        formattedKey = formattedKey.replace(/\\n/g, "\n");
      }

      if (formattedKey.includes("Bag Attributes") || formattedKey.includes("friendlyName")) {
        const keyTypes = ["RSA PRIVATE KEY", "PRIVATE KEY", "EC PRIVATE KEY"];
        for (const keyType of keyTypes) {
          const beginMarker = `-----BEGIN ${keyType}-----`;
          const endMarker = `-----END ${keyType}-----`;
          const beginIdx = formattedKey.indexOf(beginMarker);
          const endIdx = formattedKey.indexOf(endMarker);
          if (beginIdx !== -1 && endIdx !== -1) {
            formattedKey = formattedKey.substring(beginIdx, endIdx + endMarker.length);
            break;
          }
        }
      }

      if (!formattedKey.includes("\n") && formattedKey.includes("-----")) {
        const beginMatch = formattedKey.match(/-----BEGIN [^-]+-----/);
        const endMatch = formattedKey.match(/-----END [^-]+-----/);
        if (beginMatch && endMatch) {
          const header = beginMatch[0];
          const footer = endMatch[0];
          const body = formattedKey
            .replace(header, "")
            .replace(footer, "")
            .replace(/\s+/g, "");
          formattedKey = `${header}\n${body.replace(/(.{64})/g, "$1\n").trim()}\n${footer}`;
        }
      }
      if (!formattedKey.startsWith("-----BEGIN")) {
        formattedKey = `-----BEGIN PRIVATE KEY-----\n${formattedKey.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").trim()}\n-----END PRIVATE KEY-----`;
      }
      formattedKey = formattedKey.trim();

      const token = jwt.sign(payload, formattedKey, { algorithm: "RS256" });

      const expiresAt = new Date((now + expMinutes * 60) * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

      res.json({
        token,
        tokenType: "Bearer",
        expiresIn: expMinutes * 60,
        expiresAt,
        payload,
        header: `Authorization: Bearer ${token}`,
      });
    } catch (error: any) {
      console.error("JWT generation error:", error);
      if (pemKey && (error.message?.includes("PEM") || error.message?.includes("key") || error.message?.includes("asymmetric"))) {
        const pemStart = pemKey.substring(0, 30);
        const hasBegin = pemKey.includes("-----BEGIN");
        const hasEnd = pemKey.includes("-----END");
        const hasNewlines = pemKey.includes("\n");
        return res.status(400).json({ 
          message: "Erro na chave PEM. A chave privada pode estar em formato incorreto.",
          diagnostico: {
            temBeginMarker: hasBegin,
            temEndMarker: hasEnd,
            temQuebrasDeLinha: hasNewlines,
            inicio: pemStart + "...",
            dica: !hasBegin ? "A chave deve comecar com -----BEGIN PRIVATE KEY----- ou -----BEGIN RSA PRIVATE KEY-----" :
                  !hasEnd ? "A chave deve terminar com -----END PRIVATE KEY----- ou -----END RSA PRIVATE KEY-----" :
                  "Tente colar a chave PEM completa novamente nos segredos do projeto, mantendo as quebras de linha."
          }
        });
      }
      res.status(500).json({ message: "Erro ao gerar token JWT: " + (error.message || "erro desconhecido") });
    }
  });

  app.post("/api/tts", async (req, res) => {
    const txtFile = `/tmp/tts_in_${Date.now()}.txt`;
    const mp3File = `/tmp/tts_out_${Date.now()}.mp3`;
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ message: "Texto obrigatorio" });
      }

      // ── MOCK MODE GUARD ──────────────────────────────────────────
      if (MOCK_MODE) {
        return res.status(503).json({
          mock: true,
          message: "✅ [MOCK MODE ATIVO] TTS desabilitado. Sem impacto em API externa."
        });
      }
      // ─────────────────────────────────────────────────────────────
        return res.status(400).json({ message: "Texto obrigatorio" });
      }

      const cleanText = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const truncated = cleanText.slice(0, 4096);

      // Escreve texto em arquivo para evitar problemas com caracteres especiais
      fs.writeFileSync(txtFile, truncated, "utf8");

      await execFileAsync("python", [
        "-m", "edge_tts",
        "--file", txtFile,
        "--voice", "pt-BR-FranciscaNeural",
        "--write-media", mp3File,
      ], { timeout: 45000 });

      const audioBuffer = fs.readFileSync(mp3File);

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", audioBuffer.length);
      res.send(audioBuffer);
    } catch (error: any) {
      console.error("TTS error:", error);
      res.status(500).json({ message: "Erro ao gerar audio: " + (error.message || "erro desconhecido") });
    } finally {
      try { fs.unlinkSync(txtFile); } catch {}
      try { fs.unlinkSync(mp3File); } catch {}
    }
  });

  app.get("/api/jwt/status", async (_req, res) => {
    const hasPem = !!process.env.PDPJ_PEM_PRIVATE_KEY;
    res.json({ configured: hasPem });
  });

  app.get("/api/processos", requireAuth, async (_req, res) => {
    try {
      const processos = await storage.getProcessosMonitorados();
      res.json(processos);
    } catch (error: any) {
      res.status(500).json({ message: "Erro ao listar processos: " + error.message });
    }
  });

  app.get("/api/processos/:id", requireAuth, async (req, res) => {
    try {
      const processo = await storage.getProcessoMonitorado(req.params.id);
      if (!processo) return res.status(404).json({ message: "Processo nao encontrado" });
      res.json(processo);
    } catch (error: any) {
      res.status(500).json({ message: "Erro: " + error.message });
    }
  });

  app.post("/api/processos", requireAuth, async (req, res) => {
    try {
      const { numero, tribunal, apelido, classe, orgaoJulgador, dataAjuizamento, ultimaMovimentacao, ultimaMovimentacaoData, assuntos } = req.body;
      if (!numero || typeof numero !== "string" || !tribunal || typeof tribunal !== "string") {
        return res.status(400).json({ message: "Numero e tribunal sao obrigatorios" });
      }
      const validated = {
        numero: String(numero).trim(),
        tribunal: String(tribunal).trim(),
        apelido: String(apelido || "").trim(),
        classe: String(classe || "").trim(),
        orgaoJulgador: String(orgaoJulgador || "").trim(),
        dataAjuizamento: String(dataAjuizamento || "").trim(),
        ultimaMovimentacao: String(ultimaMovimentacao || "").trim(),
        ultimaMovimentacaoData: String(ultimaMovimentacaoData || "").trim(),
        assuntos: String(assuntos || "").trim(),
        status: "ativo" as const,
      };
      const processo = await storage.createProcessoMonitorado(validated);
      res.json(processo);
    } catch (error: any) {
      res.status(500).json({ message: "Erro ao salvar processo: " + error.message });
    }
  });

  app.patch("/api/processos/:id", requireAuth, async (req, res) => {
    try {
      const allowedFields = ["apelido", "status", "classe", "orgaoJulgador", "dataAjuizamento", "ultimaMovimentacao", "ultimaMovimentacaoData", "assuntos"];
      const data: Record<string, string> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          data[key] = String(req.body[key]).trim();
        }
      }
      if (data.status && !["ativo", "arquivado"].includes(data.status)) {
        return res.status(400).json({ message: "Status invalido" });
      }
      const updated = await storage.updateProcessoMonitorado(req.params.id, data);
      if (!updated) return res.status(404).json({ message: "Processo nao encontrado" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Erro ao atualizar: " + error.message });
    }
  });

  app.delete("/api/processos/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteProcessoMonitorado(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Erro ao remover: " + error.message });
    }
  });

  const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY || "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

  const TRIBUNAL_ALIASES: Record<string, string> = {
    "TJAC": "api_publica_tjac", "TJAL": "api_publica_tjal", "TJAM": "api_publica_tjam",
    "TJAP": "api_publica_tjap", "TJBA": "api_publica_tjba", "TJCE": "api_publica_tjce",
    "TJDFT": "api_publica_tjdft", "TJES": "api_publica_tjes", "TJGO": "api_publica_tjgo",
    "TJMA": "api_publica_tjma", "TJMG": "api_publica_tjmg", "TJMS": "api_publica_tjms",
    "TJMT": "api_publica_tjmt", "TJPA": "api_publica_tjpa", "TJPB": "api_publica_tjpb",
    "TJPE": "api_publica_tjpe", "TJPI": "api_publica_tjpi", "TJPR": "api_publica_tjpr",
    "TJRJ": "api_publica_tjrj", "TJRN": "api_publica_tjrn", "TJRO": "api_publica_tjro",
    "TJRR": "api_publica_tjrr", "TJRS": "api_publica_tjrs", "TJSC": "api_publica_tjsc",
    "TJSE": "api_publica_tjse", "TJSP": "api_publica_tjsp", "TJTO": "api_publica_tjto",
    "TRF1": "api_publica_trf1", "TRF2": "api_publica_trf2", "TRF3": "api_publica_trf3",
    "TRF4": "api_publica_trf4", "TRF5": "api_publica_trf5", "TRF6": "api_publica_trf6",
    "TST": "api_publica_tst", "STJ": "api_publica_stj", "STF": "api_publica_stf",
    "TRT1": "api_publica_trt1", "TRT2": "api_publica_trt2", "TRT3": "api_publica_trt3",
    "TRT4": "api_publica_trt4", "TRT5": "api_publica_trt5", "TRT6": "api_publica_trt6",
    "TRT7": "api_publica_trt7", "TRT8": "api_publica_trt8", "TRT9": "api_publica_trt9",
    "TRT10": "api_publica_trt10", "TRT11": "api_publica_trt11", "TRT12": "api_publica_trt12",
    "TRT13": "api_publica_trt13", "TRT14": "api_publica_trt14", "TRT15": "api_publica_trt15",
    "TRT16": "api_publica_trt16", "TRT17": "api_publica_trt17", "TRT18": "api_publica_trt18",
    "TRT19": "api_publica_trt19", "TRT20": "api_publica_trt20", "TRT21": "api_publica_trt21",
    "TRT22": "api_publica_trt22", "TRT23": "api_publica_trt23", "TRT24": "api_publica_trt24",
  };

  function detectTribunalFromNumber(numero: string): string | null {
    const clean = numero.replace(/[.\-\s]/g, "");
    if (clean.length < 20) return null;
    const justica = clean.substring(13, 14);
    const segmento = clean.substring(14, 16);
    if (justica === "8") {
      const tjMap: Record<string, string> = {
        "01": "TJAC", "02": "TJAL", "03": "TJAP", "04": "TJAM", "05": "TJBA",
        "06": "TJCE", "07": "TJDFT", "08": "TJES", "09": "TJGO", "10": "TJMA",
        "11": "TJMT", "12": "TJMS", "13": "TJMG", "14": "TJPA", "15": "TJPB",
        "16": "TJPE", "17": "TJPI", "18": "TJPR", "19": "TJRJ", "20": "TJRN",
        "21": "TJRO", "22": "TJRR", "23": "TJRS", "24": "TJSC", "25": "TJSE",
        "26": "TJSP", "27": "TJTO",
      };
      return tjMap[segmento] || null;
    }
    if (justica === "4") {
      const trfMap: Record<string, string> = {
        "01": "TRF1", "02": "TRF2", "03": "TRF3", "04": "TRF4", "05": "TRF5", "06": "TRF6",
      };
      return trfMap[segmento] || null;
    }
    if (justica === "5") {
      const trtMap: Record<string, string> = {
        "01": "TRT1", "02": "TRT2", "03": "TRT3", "04": "TRT4", "05": "TRT5",
        "06": "TRT6", "07": "TRT7", "08": "TRT8", "09": "TRT9", "10": "TRT10",
        "11": "TRT11", "12": "TRT12", "13": "TRT13", "14": "TRT14", "15": "TRT15",
        "16": "TRT16", "17": "TRT17", "18": "TRT18", "19": "TRT19", "20": "TRT20",
        "21": "TRT21", "22": "TRT22", "23": "TRT23", "24": "TRT24",
      };
      return trtMap[segmento] || null;
    }
    return null;
  }

  app.post("/api/datajud/consulta", requireAuth, async (req, res) => {
    try {
      const { numeroProcesso, tribunal } = req.body;
      if (!numeroProcesso || typeof numeroProcesso !== "string") {
        return res.status(400).json({ message: "Numero do processo e obrigatorio" });
      }
      const cleanNum = numeroProcesso.replace(/[.\-\s]/g, "");
      let selectedTribunal = tribunal as string;
      if (!selectedTribunal || !TRIBUNAL_ALIASES[selectedTribunal]) {
        const detected = detectTribunalFromNumber(cleanNum);
        if (detected) {
          selectedTribunal = detected;
        } else {
          return res.status(400).json({ message: "Nao foi possivel detectar o tribunal. Selecione manualmente." });
        }
      }
      const alias = TRIBUNAL_ALIASES[selectedTribunal];
      const url = `https://api-publica.datajud.cnj.jus.br/${alias}/_search`;
      const body = {
        query: {
          match: {
            numeroProcesso: cleanNum,
          },
        },
        size: 1,
      };
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `APIKey ${DATAJUD_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error("DataJud API error:", response.status, errText);
        return res.status(502).json({ message: `Erro na API DataJud: ${response.status}` });
      }
      const data = await response.json();
      const hits = data?.hits?.hits || [];
      if (hits.length === 0) {
        return res.json({ found: false, message: "Processo nao encontrado no DataJud." });
      }
      const processo = hits[0]._source;
      const movimentos = (processo.movimentos || [])
        .sort((a: any, b: any) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
      res.json({
        found: true,
        tribunal: selectedTribunal,
        processo: {
          numero: processo.numeroProcesso,
          classe: processo.classe?.nome || "",
          classeCode: processo.classe?.codigo || "",
          sistema: processo.sistema?.nome || "",
          formato: processo.formato?.nome || "",
          orgaoJulgador: processo.orgaoJulgador?.nome || "",
          codigoOrgao: processo.orgaoJulgador?.codigo || "",
          municipio: processo.orgaoJulgador?.codigoMunicipioIBGE || "",
          dataAjuizamento: processo.dataAjuizamento || "",
          dataUltimaAtualizacao: processo.dataHoraUltimaAtualizacao || "",
          grau: processo.grau || "",
          nivelSigilo: processo.nivelSigilo || 0,
          assuntos: (processo.assuntos || []).map((a: any) => ({
            nome: a.nome || "",
            codigo: a.codigo || "",
          })),
          movimentos: movimentos.map((m: any) => ({
            dataHora: m.dataHora || "",
            nome: m.nome || "",
            codigo: m.codigo || "",
            complementos: m.complementosTabelados || [],
          })),
        },
      });
    } catch (error: any) {
      console.error("DataJud error:", error);
      res.status(500).json({ message: "Erro ao consultar DataJud: " + (error.message || "erro desconhecido") });
    }
  });

  app.post("/api/datajud/consulta-oab", requireAuth, async (req, res) => {
    try {
      const { oab, uf, tribunal } = req.body;
      if (!oab || typeof oab !== "string") {
        return res.status(400).json({ message: "Numero da OAB e obrigatorio" });
      }
      if (!tribunal || !TRIBUNAL_ALIASES[tribunal]) {
        return res.status(400).json({ message: "Tribunal e obrigatorio para busca por OAB" });
      }
      const cleanOab = oab.replace(/\D/g, "");
      if (!cleanOab) {
        return res.status(400).json({ message: "Numero da OAB invalido" });
      }
      const alias = TRIBUNAL_ALIASES[tribunal];
      const url = `https://api-publica.datajud.cnj.jus.br/${alias}/_search`;
      const cleanUf = (uf || "").toUpperCase().trim();
      const oabWithUf = cleanUf ? `${cleanOab}${cleanUf}` : cleanOab;
      const queryAttempts = [
        { match: { "advogados.inscricao": cleanOab } },
        { query_string: { query: `"${cleanOab}" OR "${oabWithUf}"`, fields: ["*inscricao*", "*advogado*", "*OAB*"] } },
      ];

      let hits: any[] = [];
      for (const queryBody of queryAttempts) {
        const body = {
          query: queryBody,
          size: 50,
          sort: [{ "dataHoraUltimaAtualizacao": { order: "desc" } }],
        };
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Authorization": `APIKey ${DATAJUD_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
          if (response.ok) {
            const data = await response.json();
            hits = data?.hits?.hits || [];
            if (hits.length > 0) break;
          }
        } catch (e) {
          console.log("DataJud OAB query attempt failed:", e);
        }
      }

      if (hits.length === 0) {
        return res.json({
          found: false,
          processos: [],
          message: "A API publica do DataJud pode nao disponibilizar dados de advogados/OAB para busca. Use a busca por numero do processo, ou tente a Consulta Processual no portal do tribunal.",
        });
      }
      const processos = hits.map((hit: any) => {
        const p = hit._source;
        const movs = (p.movimentos || [])
          .sort((a: any, b: any) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
        return {
          numero: p.numeroProcesso || "",
          classe: p.classe?.nome || "",
          orgaoJulgador: p.orgaoJulgador?.nome || "",
          dataAjuizamento: p.dataAjuizamento || "",
          dataUltimaAtualizacao: p.dataHoraUltimaAtualizacao || "",
          grau: p.grau || "",
          assuntos: (p.assuntos || []).map((a: any) => ({ nome: a.nome || "", codigo: a.codigo || "" })),
          ultimaMovimentacao: movs.length > 0 ? movs[0].nome : "",
          ultimaMovimentacaoData: movs.length > 0 ? movs[0].dataHora : "",
          totalMovimentos: movs.length,
        };
      });
      res.json({ found: true, total: hits.length, tribunal, processos });
    } catch (error: any) {
      console.error("DataJud OAB error:", error);
      res.status(500).json({ message: "Erro ao consultar DataJud por OAB: " + (error.message || "erro desconhecido") });
    }
  });

  app.post("/api/datajud/consulta-cpf", requireAuth, async (req, res) => {
    try {
      const { cpf, tribunal } = req.body;
      if (!cpf || typeof cpf !== "string") {
        return res.status(400).json({ message: "CPF é obrigatório" });
      }
      const cleanCpf = cpf.replace(/\D/g, "");
      if (cleanCpf.length !== 11) {
        return res.status(400).json({ message: "CPF inválido — deve ter 11 dígitos" });
      }
      if (!tribunal || !TRIBUNAL_ALIASES[tribunal]) {
        return res.status(400).json({ message: "Tribunal é obrigatório para busca por CPF" });
      }
      const alias = TRIBUNAL_ALIASES[tribunal];
      const url = `https://api-publica.datajud.cnj.jus.br/${alias}/_search`;

      // Tenta múltiplas estratégias de busca por CPF nos campos de partes
      const queryAttempts = [
        {
          nested: {
            path: "partes",
            query: { match: { "partes.cpfCnpj": cleanCpf } },
          },
        },
        {
          query_string: {
            query: `"${cleanCpf}"`,
            fields: ["partes.cpfCnpj", "partes.cpf", "partes.documento"],
          },
        },
      ];

      let hits: any[] = [];
      for (const queryBody of queryAttempts) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Authorization": `APIKey ${DATAJUD_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: queryBody,
              size: 50,
              sort: [{ "dataHoraUltimaAtualizacao": { order: "desc" } }],
            }),
          });
          if (response.ok) {
            const data = await response.json();
            hits = data?.hits?.hits || [];
            if (hits.length > 0) break;
          }
        } catch (e) {
          console.log("DataJud CPF query attempt failed:", e);
        }
      }

      if (hits.length === 0) {
        return res.json({
          found: false,
          processos: [],
          message: "Nenhum processo encontrado para este CPF no DataJud. O campo CPF pode não estar disponível na API pública — tente buscar pelo número do processo.",
        });
      }

      const processos = hits.map((hit: any) => {
        const p = hit._source;
        const movs = (p.movimentos || [])
          .sort((a: any, b: any) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
        return {
          numero: p.numeroProcesso || "",
          classe: p.classe?.nome || "",
          orgaoJulgador: p.orgaoJulgador?.nome || "",
          dataAjuizamento: p.dataAjuizamento || "",
          dataUltimaAtualizacao: p.dataHoraUltimaAtualizacao || "",
          grau: p.grau || "",
          assuntos: (p.assuntos || []).map((a: any) => ({ nome: a.nome || "", codigo: a.codigo || "" })),
          partes: (p.partes || []).map((pt: any) => ({ nome: pt.nome || "", polo: pt.polo || "" })),
          ultimaMovimentacao: movs.length > 0 ? movs[0].nome : "",
          ultimaMovimentacaoData: movs.length > 0 ? movs[0].dataHora : "",
          totalMovimentos: movs.length,
        };
      });
      res.json({ found: true, total: hits.length, tribunal, processos });
    } catch (error: any) {
      console.error("DataJud CPF error:", error);
      res.status(500).json({ message: "Erro ao consultar DataJud por CPF: " + (error.message || "erro desconhecido") });
    }
  });

  // ===== CORPORATIVO PROXY (PDPJ) =====
  const CORPORATIVO_BASE = "https://gateway.cloud.pje.jus.br/corporativo-proxy/api/v1";

  app.get("/api/corporativo/advogado/cpf/:cpf", requireAuth, async (req, res) => {
    try {
      const cpf = req.params.cpf.replace(/\D/g, "");
      if (cpf.length !== 11) {
        return res.status(400).json({ message: "CPF inválido" });
      }
      const response = await fetch(`${CORPORATIVO_BASE}/advogado/oab/${cpf}`, {
        headers: { "Accept": "application/json" },
      });
      if (response.status === 204) {
        return res.json({ found: false, data: [] });
      }
      if (!response.ok) {
        let errMsg = `Erro na API: ${response.status}`;
        try { const t = await response.text(); if (t) errMsg = t; } catch {}
        console.error(`Corporativo advogado/cpf error: ${response.status}`, errMsg);
        if (response.status === 403) errMsg = "API bloqueada - acesso apenas de IPs brasileiros";
        return res.status(response.status).json({ message: errMsg });
      }
      const data = await response.json();
      res.json({ found: true, data: Array.isArray(data) ? data : [data] });
    } catch (error: any) {
      console.error("Corporativo advogado/cpf error:", error.message);
      res.status(500).json({ message: "Erro ao consultar API Corporativo: " + (error.message || "erro desconhecido") });
    }
  });

  app.get("/api/corporativo/advogado/oab/:uf/:inscricao", requireAuth, async (req, res) => {
    try {
      const { uf, inscricao } = req.params;
      if (!uf || !inscricao) {
        return res.status(400).json({ message: "UF e número de inscrição são obrigatórios" });
      }
      const response = await fetch(`${CORPORATIVO_BASE}/advogado/oab/${uf.toUpperCase()}/${inscricao.replace(/\D/g, "")}`, {
        headers: { "Accept": "application/json" },
      });
      if (response.status === 204) {
        return res.json({ found: false, data: null });
      }
      if (!response.ok) {
        let errMsg = `Erro na API: ${response.status}`;
        try { const t = await response.text(); if (t) errMsg = t; } catch {}
        console.error(`Corporativo advogado/oab error: ${response.status}`, errMsg);
        if (response.status === 403) errMsg = "API bloqueada - acesso apenas de IPs brasileiros";
        return res.status(response.status).json({ message: errMsg });
      }
      const data = await response.json();
      res.json({ found: true, data });
    } catch (error: any) {
      console.error("Corporativo advogado/oab error:", error.message);
      res.status(500).json({ message: "Erro ao consultar API Corporativo: " + (error.message || "erro desconhecido") });
    }
  });

  app.get("/api/corporativo/magistrados/:tribunal", requireAuth, async (req, res) => {
    try {
      const tribunal = req.params.tribunal.toUpperCase();
      const response = await fetch(`${CORPORATIVO_BASE}/magistrado?siglaTribunal=${tribunal}`, {
        headers: { "Accept": "application/json" },
      });
      if (!response.ok) {
        let errMsg = `Erro na API: ${response.status}`;
        try { const t = await response.text(); if (t) errMsg = t; } catch {}
        console.error(`Corporativo magistrados error: ${response.status}`, errMsg);
        if (response.status === 403) errMsg = "API bloqueada - acesso apenas de IPs brasileiros";
        return res.status(response.status).json({ message: errMsg });
      }
      const data = await response.json();
      res.json({ found: true, data: Array.isArray(data) ? data : [] });
    } catch (error: any) {
      console.error("Corporativo magistrados error:", error.message);
      res.status(500).json({ message: "Erro ao consultar magistrados: " + (error.message || "erro desconhecido") });
    }
  });

  // ===== PDPJ AUTHENTICATED API PROXY =====
  const DOMICILIO_BASE_PROD = "https://domicilio-eletronico.pdpj.jus.br";
  const DOMICILIO_BASE_STG = "https://gateway.stg.cloud.pje.jus.br/domicilio-eletronico-hml";
  const COMUNICAAPI_BASE_PROD = "https://comunicaapi.pje.jus.br/api/v1";
  const COMUNICAAPI_BASE_STG = "https://hcomunicaapi.cnj.jus.br/api/v1";

  function formatPemKey(pemKey: string): string {
    let formattedKey = pemKey;
    if (formattedKey.includes("\\n")) {
      formattedKey = formattedKey.replace(/\\n/g, "\n");
    }
    if (formattedKey.includes("Bag Attributes") || formattedKey.includes("friendlyName")) {
      const keyTypes = ["RSA PRIVATE KEY", "PRIVATE KEY", "EC PRIVATE KEY"];
      for (const keyType of keyTypes) {
        const beginMarker = `-----BEGIN ${keyType}-----`;
        const endMarker = `-----END ${keyType}-----`;
        const beginIdx = formattedKey.indexOf(beginMarker);
        const endIdx = formattedKey.indexOf(endMarker);
        if (beginIdx !== -1 && endIdx !== -1) {
          formattedKey = formattedKey.substring(beginIdx, endIdx + endMarker.length);
          break;
        }
      }
    }
    if (!formattedKey.includes("\n") && formattedKey.includes("-----")) {
      const beginMatch = formattedKey.match(/-----BEGIN [^-]+-----/);
      const endMatch = formattedKey.match(/-----END [^-]+-----/);
      if (beginMatch && endMatch) {
        const header = beginMatch[0];
        const footer = endMatch[0];
        const body = formattedKey.replace(header, "").replace(footer, "").replace(/\s+/g, "");
        formattedKey = `${header}\n${body.replace(/(.{64})/g, "$1\n").trim()}\n${footer}`;
      }
    }
    if (!formattedKey.startsWith("-----BEGIN")) {
      formattedKey = `-----BEGIN PRIVATE KEY-----\n${formattedKey.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").trim()}\n-----END PRIVATE KEY-----`;
    }
    return formattedKey.trim();
  }

  function generatePdpjToken(cpf: string, modo: "pdpj" | "pjud" = "pdpj", tribunal: string = "TJMG", expiresMinutes: number = 15, ambiente: string = "homologacao"): string | null {
    const pemKey = process.env.PDPJ_PEM_PRIVATE_KEY;
    if (!pemKey) return null;

    const formattedKey = formatPemKey(pemKey);
    const now = Math.floor(Date.now() / 1000);
    const isPjud = modo === "pjud";
    const isProd = ambiente === "producao";

    const payload: Record<string, any> = {
      sub: cpf,
      iss: isPjud
        ? (isProd ? "pjud-client" : "pjud-client-hml")
        : "pdpj-br",
      aud: isPjud
        ? (isProd ? "https://gateway.cloud.pje.jus.br" : "https://gateway.stg.cloud.pje.jus.br")
        : (isProd ? "https://gateway.cloud.pje.jus.br" : "https://gateway.stg.cloud.pje.jus.br"),
      iat: now,
      exp: now + (expiresMinutes * 60),
      jti: `${isPjud ? "pjud" : "pdpj"}-${Date.now()}`,
      tribunal,
      scope: "pdpj.read pdpj.write",
    };

    return jwt.sign(payload, formattedKey, { algorithm: "RS256" });
  }

  async function pdpjFetch(url: string, token: string, cpf?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
    };
    if (cpf) {
      headers["On-behalf-Of"] = cpf.replace(/\D/g, "");
    }
    return fetch(url, { headers });
  }

  app.get("/api/pdpj/status", requireAuth, (_req, res) => {
    const hasPem = !!process.env.PDPJ_PEM_PRIVATE_KEY;
    res.json({ configured: hasPem });
  });

  app.post("/api/pdpj/test-connection", requireAuth, async (req, res) => {
    try {
      const { cpf, modo, tribunal, ambiente } = req.body;
      const cleanCpf = (cpf || "").replace(/\D/g, "");
      if (cleanCpf.length !== 11) {
        return res.status(400).json({ message: "CPF inválido" });
      }

      const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
      if (!token) {
        return res.status(400).json({ message: "Chave PEM não configurada" });
      }

      const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
      const response = await pdpjFetch(`${baseUrl}/api/v1/eu`, token, cleanCpf);

      if (response.ok) {
        const data = await response.json();
        res.json({ connected: true, data, ambiente: ambiente || "homologacao" });
      } else {
        let errMsg = `Status ${response.status}`;
        try { const t = await response.text(); if (t) errMsg = t; } catch {}
        if (response.status === 403) errMsg = "Acesso bloqueado - API restrita a IPs brasileiros";
        if (response.status === 401) errMsg = "Token não autorizado - verifique se a chave PEM está registrada no PDPJ";
        res.json({ connected: false, status: response.status, message: errMsg });
      }
    } catch (error: any) {
      console.error("PDPJ test connection error:", error.message);
      res.json({ connected: false, message: "Erro de conexão: " + (error.message || "desconhecido") });
    }
  });

  app.post("/api/pdpj/comunicacoes", requireAuth, async (req, res) => {
    try {
      const { cpf, modo, tribunal, ambiente, dataInicio, dataFim, pagina } = req.body;
      const cleanCpf = (cpf || "").replace(/\D/g, "");
      if (cleanCpf.length !== 11) {
        return res.status(400).json({ message: "CPF inválido" });
      }

      const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
      if (!token) {
        return res.status(400).json({ message: "Chave PEM não configurada" });
      }

      const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
      let url = `${baseUrl}/api/v1/comunicacoes-representantes?page=${pagina || 0}&size=20`;
      if (dataInicio) url += `&dataInicio=${dataInicio}`;
      if (dataFim) url += `&dataFim=${dataFim}`;

      const response = await pdpjFetch(url, token, cleanCpf);

      if (!response.ok) {
        let errMsg = `Erro ${response.status}`;
        try { const t = await response.text(); if (t) errMsg = t; } catch {}
        if (response.status === 403) errMsg = "API restrita a IPs brasileiros";
        if (response.status === 401) errMsg = "Token não autorizado";
        return res.status(response.status).json({ message: errMsg });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("PDPJ comunicacoes error:", error.message);
      res.status(500).json({ message: "Erro ao consultar comunicações: " + (error.message || "desconhecido") });
    }
  });

  app.post("/api/pdpj/representados", requireAuth, async (req, res) => {
    try {
      const { cpf, modo, tribunal, ambiente, dataInicio, dataFim } = req.body;
      const cleanCpf = (cpf || "").replace(/\D/g, "");
      if (cleanCpf.length !== 11) {
        return res.status(400).json({ message: "CPF inválido" });
      }

      const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
      if (!token) {
        return res.status(400).json({ message: "Chave PEM não configurada" });
      }

      const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
      let url = `${baseUrl}/api/v1/representados`;
      const params: string[] = [];
      if (dataInicio) params.push(`dataInicio=${dataInicio}`);
      if (dataFim) params.push(`dataFim=${dataFim}`);
      if (params.length) url += `?${params.join("&")}`;

      const response = await pdpjFetch(url, token, cleanCpf);

      if (!response.ok) {
        let errMsg = `Erro ${response.status}`;
        try { const t = await response.text(); if (t) errMsg = t; } catch {}
        if (response.status === 403) errMsg = "API restrita a IPs brasileiros";
        if (response.status === 401) errMsg = "Token não autorizado";
        return res.status(response.status).json({ message: errMsg });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("PDPJ representados error:", error.message);
      res.status(500).json({ message: "Erro ao consultar representados: " + (error.message || "desconhecido") });
    }
  });

  app.post("/api/pdpj/habilitacao", requireAuth, async (req, res) => {
    try {
      const { cpf, modo, tribunal, ambiente, documento } = req.body;
      const cleanCpf = (cpf || "").replace(/\D/g, "");
      if (cleanCpf.length !== 11) {
        return res.status(400).json({ message: "CPF inválido" });
      }
      const cleanDoc = (documento || "").replace(/\D/g, "");
      if (!cleanDoc || (cleanDoc.length !== 11 && cleanDoc.length !== 14)) {
        return res.status(400).json({ message: "Documento (CPF ou CNPJ) inválido" });
      }

      const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
      if (!token) {
        return res.status(400).json({ message: "Chave PEM não configurada" });
      }

      const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
      const response = await pdpjFetch(`${baseUrl}/api/v1/pessoas/${cleanDoc}/verificar-habilitacao`, token, cleanCpf);

      if (!response.ok) {
        let errMsg = `Erro ${response.status}`;
        try { const t = await response.text(); if (t) errMsg = t; } catch {}
        if (response.status === 403) errMsg = "API restrita a IPs brasileiros";
        if (response.status === 401) errMsg = "Token não autorizado";
        return res.status(response.status).json({ message: errMsg });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("PDPJ habilitacao error:", error.message);
      res.status(500).json({ message: "Erro ao verificar habilitação: " + (error.message || "desconhecido") });
    }
  });

  app.post("/api/pdpj/pessoa", requireAuth, async (req, res) => {
    try {
      const { cpf, modo, tribunal, ambiente, tipoPessoa, documento } = req.body;
      const cleanCpf = (cpf || "").replace(/\D/g, "");
      if (cleanCpf.length !== 11) {
        return res.status(400).json({ message: "CPF inválido" });
      }

      const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
      if (!token) {
        return res.status(400).json({ message: "Chave PEM não configurada" });
      }

      const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
      const cleanDoc = (documento || "").replace(/\D/g, "");
      let url: string;
      if (tipoPessoa === "juridica") {
        url = `${baseUrl}/api/v1/pessoas-juridicas?cnpj=${cleanDoc}`;
      } else {
        url = `${baseUrl}/api/v1/pessoas-fisicas-pdpj?cpf=${cleanDoc}`;
      }

      const response = await pdpjFetch(url, token, cleanCpf);

      if (!response.ok) {
        let errMsg = `Erro ${response.status}`;
        try { const t = await response.text(); if (t) errMsg = t; } catch {}
        if (response.status === 403) errMsg = "API restrita a IPs brasileiros";
        if (response.status === 401) errMsg = "Token não autorizado";
        return res.status(response.status).json({ message: errMsg });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("PDPJ pessoa error:", error.message);
      res.status(500).json({ message: "Erro ao consultar pessoa: " + (error.message || "desconhecido") });
    }
  });

  app.get("/api/datajud/tribunais", requireAuth, (_req, res) => {
    const tribunais = Object.keys(TRIBUNAL_ALIASES).map(key => ({
      sigla: key,
      tipo: key.startsWith("TJ") ? "Estadual" : key.startsWith("TRF") ? "Federal" : key.startsWith("TRT") ? "Trabalhista" : "Superior",
    }));
    res.json(tribunais);
  });

  // ─── App Settings ─────────────────────────────────────────────────────────
  app.get("/api/settings/:key", requireAuth, async (req, res) => {
    try {
      const value = await storage.getSetting(req.params.key);
      res.json({ value });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/settings/:key", requireAuth, async (req, res) => {
    try {
      const { value } = req.body;
      if (typeof value !== "string") return res.status(400).json({ message: "value required" });
      await storage.setSetting(req.params.key, value);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Tramitação Inteligente Proxy ──────────────────────────────────────────
  const TRAMITACAO_BASE = "https://planilha.tramitacaointeligente.com.br/api/v1";

  async function tramitacaoFetch(path: string, method: string, token: string, body?: any) {
    const res = await fetch(`${TRAMITACAO_BASE}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  app.get("/api/tramitacao/clientes", requireAuth, async (req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.status(400).json({ message: "Token do Tramitação Inteligente não configurado." });
      const qs = new URLSearchParams();
      if (req.query.page) qs.set("page", String(req.query.page));
      if (req.query.per_page) qs.set("per_page", String(req.query.per_page));
      const upstream = await tramitacaoFetch(`/clientes?${qs}`, "GET", token);
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/tramitacao/clientes", requireAuth, async (req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.status(400).json({ message: "Token não configurado." });
      const upstream = await tramitacaoFetch("/clientes", "POST", token, req.body);
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/tramitacao/clientes/:id", requireAuth, async (req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.status(400).json({ message: "Token não configurado." });
      const upstream = await tramitacaoFetch(`/clientes/${req.params.id}`, "GET", token);
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/tramitacao/clientes/:id", requireAuth, async (req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.status(400).json({ message: "Token não configurado." });
      const upstream = await tramitacaoFetch(`/clientes/${req.params.id}`, "PATCH", token, req.body);
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/tramitacao/notas", requireAuth, async (req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.status(400).json({ message: "Token não configurado." });
      const qs = new URLSearchParams();
      if (req.query.customer_id) qs.set("customer_id", String(req.query.customer_id));
      if (req.query.page) qs.set("page", String(req.query.page));
      if (req.query.per_page) qs.set("per_page", String(req.query.per_page));
      const upstream = await tramitacaoFetch(`/notas?${qs}`, "GET", token);
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/tramitacao/notas", requireAuth, async (req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.status(400).json({ message: "Token não configurado." });
      const upstream = await tramitacaoFetch("/notas", "POST", token, req.body);
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/tramitacao/notas/:id", requireAuth, async (req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.status(400).json({ message: "Token não configurado." });
      const upstream = await tramitacaoFetch(`/notas/${req.params.id}`, "DELETE", token);
      res.status(upstream.status).json({ ok: upstream.status === 204 });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/tramitacao/usuarios", requireAuth, async (_req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.status(400).json({ message: "Token não configurado." });
      const upstream = await tramitacaoFetch("/usuarios?per_page=100", "GET", token);
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/tramitacao/test", requireAuth, async (_req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.json({ ok: false, message: "Token não configurado. Acesse Configurações e insira seu token." });
      if (/^\d+$/.test(token.trim())) {
        return res.json({ ok: false, message: `O valor "${token}" parece ser um ID de assinante, não um token de API. Acesse planilha.tramitacaointeligente.com.br/api/chaves para obter o token correto.` });
      }
      const upstream = await tramitacaoFetch("/clientes?per_page=1", "GET", token);
      if (upstream.ok) {
        return res.json({ ok: true, message: "Conexão OK! Token válido e API respondendo." });
      } else if (upstream.status === 401) {
        return res.json({ ok: false, message: "Token inválido ou expirado (401). Verifique em planilha.tramitacaointeligente.com.br/api/chaves." });
      } else {
        const body = await upstream.text().catch(() => "");
        return res.json({ ok: false, message: `API retornou ${upstream.status}: ${body.slice(0, 100)}` });
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get("/api/tramitacao/publicacoes", requireAuth, async (_req, res) => {
    try {
      const pubs = await storage.getTramitacaoPublicacoes(200);
      res.json({ publicacoes: pubs });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Sync publications from Tramitação Inteligente API directly
  app.post("/api/tramitacao/sync-publicacoes", requireAuth, async (_req, res) => {
    try {
      const token = await storage.getSetting("tramitacao_token");
      if (!token) return res.status(400).json({ message: "Token do Tramitação Inteligente não configurado. Vá em Configurações e salve seu token." });

      // Try fetching publications from the API (most likely endpoint names)
      const endpoints = ["/publications?per_page=50&page=1", "/publicacoes?per_page=50&page=1"];
      let rawPubs: any[] = [];
      let fetchOk = false;

      for (const ep of endpoints) {
        try {
          const upstream = await tramitacaoFetch(ep, "GET", token);
          if (upstream.ok) {
            const data = await upstream.json();
            // Handle both array and object responses
            rawPubs = Array.isArray(data) ? data
              : Array.isArray(data?.publications) ? data.publications
              : Array.isArray(data?.publicacoes) ? data.publicacoes
              : Array.isArray(data?.data) ? data.data
              : [];
            fetchOk = true;
            break;
          }
        } catch (_) { /* try next endpoint */ }
      }

      if (!fetchOk) {
        // If API fetch failed, just return what's in our local DB
        const localPubs = await storage.getTramitacaoPublicacoes(200);
        return res.json({ publicacoes: localPubs, synced: 0, source: "local", warning: "Não foi possível conectar à API do Tramitação Inteligente. Mostrando publicações locais recebidas via webhook." });
      }

      let savedCount = 0;
      for (const pub of rawPubs) {
        try {
          await storage.upsertTramitacaoPublicacao({
            extId: String(pub.id || pub.ext_id || Math.random()),
            idempotencyKey: pub.idempotency_key || "",
            numeroProcesso: pub.numero_processo || pub.process_number || "",
            numeroProcessoMascara: pub.numero_processo_com_mascara || pub.numero_processo || "",
            tribunal: pub.siglaTribunal || pub.tribunal || pub.court || "",
            orgao: pub.nomeOrgao || pub.orgao || pub.organ || "",
            classe: pub.nomeClasse || pub.classe || pub.class || "",
            texto: pub.texto || pub.text || pub.content || "",
            disponibilizacaoDate: pub.disponibilizacao_date || pub.available_date || "",
            publicacaoDate: pub.publication_date || pub.published_at || "",
            inicioPrazoDate: pub.inicio_do_prazo_date || pub.deadline_start || "",
            linkTramitacao: pub.link_tramitacao || pub.link || "",
            linkTribunal: pub.link_tribunal || pub.tribunal_link || "",
            destinatarios: JSON.stringify(pub.destinatarios || pub.recipients || []),
            advogados: JSON.stringify(pub.destinatario_advogados || pub.lawyers || []),
          });
          savedCount++;
        } catch (_) { /* skip invalid entries */ }
      }

      const allPubs = await storage.getTramitacaoPublicacoes(200);
      res.json({ publicacoes: allPubs, synced: savedCount, source: "api" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/tramitacao/publicacoes/:id/lida", requireAuth, async (req, res) => {
    try {
      await storage.markPublicacaoLida(req.params.id, req.body.lida || "sim");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
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
        return res.json({ output: "", error: "", executedCode: "" });
      }
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
        model: "gemini-2.5-flash",
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
