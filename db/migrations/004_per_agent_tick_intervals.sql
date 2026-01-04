-- Migration: Per-Agent Tick Intervals
-- Date: 2026-01-04
-- Description: Add per-agent tick interval support with arena min/max bounds

-- ============================================
-- PHASE 1: Agent Tick Interval
-- ============================================

-- Add tick_interval to agents table
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tick_interval INTEGER DEFAULT 60;

-- ============================================
-- PHASE 2: Arena Min/Max Tick Bounds
-- ============================================

-- Add min/max tick interval to arena_rounds
ALTER TABLE arena_rounds
  ADD COLUMN IF NOT EXISTS min_tick_interval INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_tick_interval INTEGER DEFAULT 120;

-- ============================================
-- PHASE 3: Round Participants Effective Tick
-- ============================================

-- Add effective_tick_interval to round_participants
-- This stores the agent's tick interval at the time they joined
ALTER TABLE round_participants
  ADD COLUMN IF NOT EXISTS effective_tick_interval INTEGER;

-- Update existing participants with a default value
UPDATE round_participants
SET effective_tick_interval = 60
WHERE effective_tick_interval IS NULL;

-- ============================================
-- Indexes for Performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_agents_tick_interval ON agents(tick_interval);

-- ============================================
-- Comments for Documentation
-- ============================================

COMMENT ON COLUMN agents.tick_interval IS 'How often (in seconds) this agent receives market data ticks. Range: 5-300s';
COMMENT ON COLUMN arena_rounds.min_tick_interval IS 'Minimum allowed tick interval for agents joining this arena';
COMMENT ON COLUMN arena_rounds.max_tick_interval IS 'Maximum allowed tick interval for agents joining this arena';
COMMENT ON COLUMN round_participants.effective_tick_interval IS 'The agent tick interval locked when they joined the arena';
