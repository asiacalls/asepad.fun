import { z } from "zod";

export const baseEnvSchema = z.object({
  ASENTRISE_ENV: z.enum(["development", "test", "production"]).default("development"),

  WEB_URL: z.string().url(),
  API_URL: z.string().url(),
  ADMIN_URL: z.string().url().optional(),
  PLATFORM_NAME: z.string().optional(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1).default("7d"),

  ASENTUM_NETWORK_KEY: z.string().min(1).default("asentum-testnet"),
  ASENTUM_NETWORK_NAME: z.string().min(1).default("Asentum Testnet"),
  ASENTUM_RPC_HTTP: z.string().url(),
  ASENTUM_RPC_WS: z.string().url().optional(),
  ASENTUM_EXPLORER_BASE_URL: z.string().url().optional(),
  ASENTUM_CHAIN_ID: z.string().min(1).optional()
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function parseBaseEnv(env: NodeJS.ProcessEnv): BaseEnv {
  const parsed = baseEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(parsed.error.flatten().fieldErrors ? JSON.stringify(parsed.error.flatten().fieldErrors) : "Invalid env");
  }
  return parsed.data;
}
