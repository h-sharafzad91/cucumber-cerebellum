-- Migration: Change user_id from UUID to TEXT to support wallet addresses
-- Wallet addresses are hex strings (0x...), not UUIDs

ALTER TABLE agents
  ALTER COLUMN user_id TYPE TEXT;

-- Add index for performance on user_id lookups
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
