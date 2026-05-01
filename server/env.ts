import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  COHERE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MS_TENANT_ID: z.string().optional(),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
  MS_SHAREPOINT_HOSTNAME: z.string().optional(),
  MS_SHAREPOINT_SITE: z.string().optional(),
  SESSION_SECRET: z.string().default("dev-session-secret"),
  CHUNK_TOKEN_SIZE: z.coerce.number().default(800),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().default(100),
  EMBEDDING_DIM: z.coerce.number().default(1536),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed");
}

export const env = parsed.data;

export const hasCohere = () => Boolean(env.COHERE_API_KEY);
export const hasOpenAI = () => Boolean(env.OPENAI_API_KEY);
export const hasSharepoint = () =>
  Boolean(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
