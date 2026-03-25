
import { Router } from "express";
import { z } from "zod";

const router = Router();

// Estado em memória (substituir por banco de dados se precisar persistir entre reinícios)
let robotStatus = {
  isRunning: false,
  lastRun: null as Date | null,
  logs: [] as string[],
  tasksCompleted: 0
};

// Schema de validação
const executeSchema = z.object({
  action: z.enum(["check_new_lawsuits", "send_emails", "full_cycle"]).optional(),
  dryRun: z.boolean().optional().default(false)
});

router.get("/status", (req, res) => {
  res.json({
    status: robotStatus.isRunning ? "running" : "idle",
    lastRun: robotStatus.lastRun,
    tasksCompleted: robotStatus.tasksCompleted,
    details: "TypeScript Node.js Worker"
  });
});

router.post("/execute", (req, res) => {
  try {
    const { action, dryRun } = req.body; 

    if (robotStatus.isRunning) {
      return res.status(409).json({ message: "Robô já está em execução" });
    }

    robotStatus.isRunning = true;
    robotStatus.logs.push(`[${new Date().toISOString()}] Iniciando tarefa: ${action || 'default'} (DryRun: ${dryRun})`);

    // Simulação de processo assíncrono
    setTimeout(() => {
      robotStatus.logs.push(`[${new Date().toISOString()}] Conectando aos tribunais...`);
      
      setTimeout(() => {
        robotStatus.logs.push(`[${new Date().toISOString()}] Tarefa concluída com sucesso.`);
        robotStatus.isRunning = false;
        robotStatus.lastRun = new Date();
        robotStatus.tasksCompleted++;
      }, 5000);
    }, 1000);

    res.json({ message: "Tarefa iniciada", status: "running" });
  } catch (error) {
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

router.get("/logs", (req, res) => {
  res.json(robotStatus.logs);
});

export const roboRouter = router;
