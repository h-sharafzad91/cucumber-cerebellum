import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string(),
  SUPABASE_URL: z.string(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  REDIS_URL: z.string(),
  ALCHEMY_RPC_URL: z.string(),
  SIGNER_PRIVATE_KEY: z.string(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  CORTEX_URL: z.string().default('http://localhost:8000'),
  PAPER_TRADING: z.string().default('true'),
  SENTRY_DSN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = {
  port: parseInt(parsed.data.PORT, 10),
  nodeEnv: parsed.data.NODE_ENV,
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',

  database: {
    url: parsed.data.DATABASE_URL,
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY,
  },

  redis: {
    url: parsed.data.REDIS_URL,
  },

  blockchain: {
    rpcUrl: parsed.data.ALCHEMY_RPC_URL,
    signerPrivateKey: parsed.data.SIGNER_PRIVATE_KEY as `0x${string}`,
  },

  cors: {
    origins: parsed.data.ALLOWED_ORIGINS.split(','),
  },

  cortex: {
    url: parsed.data.CORTEX_URL,
  },

  sentry: {
    dsn: parsed.data.SENTRY_DSN,
  },

  arena: {
    tickInterval: 120,
    maxOrderUsd: 2000,
    allowedAssets: ['ETH', 'USDC'] as const,
    paperTrading: parsed.data.PAPER_TRADING === 'true',
    initialBalance: 10000,
  },

  risk: {
    maxDrawdownPercent: 20,
    maxPositionConcentration: 0.5,
    maxConsecutiveLosses: 5,
    minBalancePercent: 10,
  },
} as const;

export type Config = typeof config;
