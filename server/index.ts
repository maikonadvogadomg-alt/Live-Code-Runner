// ============================================================
// MOCK MODE — startup seguro sem DATABASE_URL / SESSION_SECRET
// ============================================================
const MOCK_MODE =
  !process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
  process.env.MOCK_MODE === "true";

import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "60mb" }));

const isProduction = process.env.NODE_ENV === "production";
if (isProduction) {
  app.set("trust proxy", 1);
}

// ── Sessão: PostgreSQL em produção/completo, MemoryStore em mock ──────────────
if (!MOCK_MODE && process.env.DATABASE_URL) {
  // Importações dinâmicas para evitar erro quando DB não está disponível
  const connectPg = (await import("connect-pg-simple")).default;
  const pg = (await import("pg")).default;
  const PgSession = connectPg(session);

  // 🔒 SSL obrigatório para Neon PostgreSQL (serverless)
  const requireSsl =
    process.env.DATABASE_URL?.includes("neon.tech") ||
    process.env.DATABASE_URL?.includes("sslmode=require");

  const sessionPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: requireSsl ? { rejectUnauthorized: true } : false,
  });

  app.use(session({
    store: new PgSession({
      pool: sessionPool,
      tableName: "session",
    }),
    secret: process.env.SESSION_SECRET || "mock-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  }));
} else {
  // Mock/dev sem banco: usa MemoryStore simples
  if (MOCK_MODE) {
    console.warn("⚠️  [MOCK MODE] Usando MemoryStore para sessões (não usar em produção).");
  }
  app.use(session({
    secret: process.env.SESSION_SECRET || "mock-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    },
  }));
}
// ─────────────────────────────────────────────────────────────────────────────

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("pt-BR", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    if (MOCK_MODE) {
      log("⚠️  MOCK MODE ATIVO — APIs externas desabilitadas", "mock");
    }
  });
})();
