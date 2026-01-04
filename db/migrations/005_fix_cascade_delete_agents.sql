-- Migration: Fix cascade delete for agents
-- Date: 2026-01-04
-- Description: Update foreign key constraints to CASCADE on agent deletion

-- Drop and recreate foreign key constraints with CASCADE

-- Ticks table
ALTER TABLE ticks DROP CONSTRAINT IF EXISTS ticks_agent_id_fkey;
ALTER TABLE ticks ADD CONSTRAINT ticks_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

-- Agent ticks table
ALTER TABLE agent_ticks DROP CONSTRAINT IF EXISTS agent_ticks_agent_id_fkey;
ALTER TABLE agent_ticks ADD CONSTRAINT agent_ticks_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

-- Trades table
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_agent_id_fkey;
ALTER TABLE trades ADD CONSTRAINT trades_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

-- Positions table
ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_agent_id_fkey;
ALTER TABLE positions ADD CONSTRAINT positions_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

-- Round participants table
ALTER TABLE round_participants DROP CONSTRAINT IF EXISTS round_participants_agent_id_fkey;
ALTER TABLE round_participants ADD CONSTRAINT round_participants_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

-- Arena payouts table
ALTER TABLE arena_payouts DROP CONSTRAINT IF EXISTS arena_payouts_agent_id_fkey;
ALTER TABLE arena_payouts ADD CONSTRAINT arena_payouts_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
