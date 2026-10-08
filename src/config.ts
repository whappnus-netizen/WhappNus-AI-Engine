import "dotenv/config";
import { z } from "zod";

const schema=z.object({
  NODE_ENV:z.string().default("development"),
  PORT:z.coerce.number().default(3000),
  SUPABASE_URL:z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY:z.string().min(1),
  AI_INTERNAL_SECRET:z.string().min(16),
  AI_PROVIDER:z.enum(["lovable","openai","gemini","anthropic"]).default("lovable"),
  AI_MODEL:z.string().default("gemini-3.8-flash"),
  LOVABLE_API_KEY:z.string().optional(),
  OPENAI_API_KEY:z.string().optional(),
  GEMINI_API_KEY:z.string().optional(),
  ANTHROPIC_API_KEY:z.string().optional(),
  AI_MAX_OUTPUT_TOKENS:z.coerce.number().int().positive().max(8192).default(800),
  AI_TEMPERATURE:z.coerce.number().min(0).max(2).default(0.4),
  AI_HISTORY_LIMIT:z.coerce.number().int().positive().max(100).default(20),
  AI_KNOWLEDGE_LIMIT:z.coerce.number().int().positive().max(50).default(12),
  AI_RATE_LIMIT_PER_MINUTE:z.coerce.number().int().positive().max(1000).default(20)
}).passthrough();

export const config=schema.parse(process.env);
