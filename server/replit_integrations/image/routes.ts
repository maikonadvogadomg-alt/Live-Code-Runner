// ============================================================
// MOCK MODE — desativa geração de imagens quando API key ausente
// ============================================================
const MOCK_MODE =
  !process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
  process.env.MOCK_MODE === "true";

import type { Express, Request, Response } from "express";
import { openai } from "./client";

export function registerImageRoutes(app: Express): void {
  app.post("/api/generate-image", async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024" } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      // ── MOCK MODE GUARD ──────────────────────────────────────────────────
      if (MOCK_MODE) {
        return res.json({
          mock: true,
          url: null,
          b64_json: null,
          message:
            "✅ [MOCK MODE ATIVO] Geração de imagem desabilitada. " +
            "Defina AI_INTEGRATIONS_OPENAI_API_KEY para gerar imagens reais.",
        });
      }
      // ─────────────────────────────────────────────────────────────────────

      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: size as "1024x1024" | "512x512" | "256x256",
      });

      const imageData = response.data[0];
      res.json({
        url: imageData.url,
        b64_json: imageData.b64_json,
      });
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ error: "Failed to generate image" });
    }
  });
}
