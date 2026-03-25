// @ts-nocheck
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

type RoboRunResult = {
  sucesso?: boolean;
  mensagem?: string;
  resultados?: unknown[];
  estatisticas?: Record<string, unknown>;
  timestamp?: string;
};

type RoboApiResponse = {
  success: boolean;
  data?: {
    message: string;
    results: unknown[];
    statistics: Record<string, unknown>;
    timestamp: string;
  };
  error?: string;
};

function runPython(commands: Array<{ cmd: string; args: string[] }>, timeoutMs = 300000) {
  const errors: string[] = [];

  for (const attempt of commands) {
    const proc = spawnSync(attempt.cmd, attempt.args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
    });

    if (!proc.error && proc.status === 0) {
      return { ok: true as const, stdout: proc.stdout || "" };
    }

    const errText = proc.error?.message || proc.stderr || `exit code ${proc.status}`;
    errors.push(`${attempt.cmd}: ${errText}`);
  }

  return { ok: false as const, error: errors.join(" | ") };
}

function parseJsonFromStdout(stdout: string): RoboRunResult {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    try {
      return JSON.parse(line) as RoboRunResult;
    } catch {
      // Keep scanning previous lines until a valid JSON payload is found.
    }
  }

  throw new Error("Saida do Python nao contem JSON valido");
}

export class RoboJuridicoController {
  static executar_robo(): RoboApiResponse {
    const script = [
      "import os, sys, json",
      "sys.path.insert(0, os.path.join(os.getcwd(), 'robo-juridico'))",
      "from robo_juridico_api import RoboJuridico",
      "resultado = RoboJuridico().executar()",
      "print(json.dumps(resultado, ensure_ascii=False))",
    ].join("; ");

    const execution = runPython([
      { cmd: "python", args: ["-c", script] },
      { cmd: "python3", args: ["-c", script] },
      { cmd: "py", args: ["-3", "-c", script] },
    ]);

    if (!execution.ok) {
      return {
        success: false,
        error: `Falha ao executar Python do robo juridico: ${execution.error}`,
      };
    }

    try {
      const resultado = parseJsonFromStdout(execution.stdout);
      return {
        success: Boolean(resultado.sucesso),
        data: {
          message: resultado.mensagem || "",
          results: Array.isArray(resultado.resultados) ? resultado.resultados : [],
          statistics: resultado.estatisticas || {},
          timestamp: resultado.timestamp || new Date().toISOString(),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Erro ao interpretar retorno do robo juridico: ${error.message}`,
      };
    }
  }

  static obter_status(): RoboApiResponse {
    try {
      const roboDir = path.join(process.cwd(), "robo-juridico");
      const arquivosNecessarios = [
        "main.py",
        "config.py",
        "modules/api_djen.py",
        "modules/regex_parser.py",
        "modules/excel_manager.py",
        "modules/email_draft.py",
        "modules/drive_manager.py",
      ];

      const arquivos: Record<string, boolean> = {};
      for (const relPath of arquivosNecessarios) {
        arquivos[relPath] = fs.existsSync(path.join(roboDir, relPath));
      }

      const clientesPath = process.env.ARQUIVO_CLIENTES
        ? (path.isAbsolute(process.env.ARQUIVO_CLIENTES)
            ? process.env.ARQUIVO_CLIENTES
            : path.join(process.cwd(), process.env.ARQUIVO_CLIENTES))
        : path.join(roboDir, "clientes.xlsx");

      const pythonCheck = runPython([
        { cmd: "python", args: ["--version"] },
        { cmd: "python3", args: ["--version"] },
        { cmd: "py", args: ["-3", "--version"] },
      ], 15000);

      const configuracoes = {
        EMAIL_LOGIN: Boolean(process.env.EMAIL_LOGIN),
        SENHA_APP: Boolean(process.env.SENHA_APP),
        DJEN_TOKEN: Boolean(process.env.DJEN_TOKEN),
        ARQUIVO_CLIENTES: fs.existsSync(clientesPath),
        DATABASE_URL: Boolean(process.env.DATABASE_URL),
        PYTHON_OK: pythonCheck.ok,
      };

      const todosConfigurados = Object.values(configuracoes).every(Boolean);

      return {
        success: true,
        data: {
          message: todosConfigurados
            ? "Robo juridico configurado corretamente"
            : "Configuracao incompleta. Verifique variaveis de ambiente, Python e arquivos.",
          results: [],
          statistics: {
            status: todosConfigurados ? "ativo" : "configuracao_incompleta",
            arquivos,
            configuracoes,
            todos_configurados: todosConfigurados,
          },
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Erro ao verificar status do robo juridico: ${error.message}`,
      };
    }
  }
}
