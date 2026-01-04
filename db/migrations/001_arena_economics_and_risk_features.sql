-- Migration: Arena Economics and Risk Features
-- Date: 2025-12-23
-- Description: Add fields for prize pools, buy-ins, payouts, leverage, and stop-loss/take-profit

-- ============================================
-- PHASE 1: Arena Economics Fields
-- ============================================

ALTER TABLE arena_rounds
  ADD COLUMN IF NOT EXISTS arena_type VARCHAR(50) DEFAULT 'tournament' CHECK (arena_type IN ('tournament', 'contest')),
  ADD COLUMN IF NOT EXISTS trading_pair VARCHAR(50) DEFAULT 'BTC/USDT',
  ADD COLUMN IF NOT EXISTS prize_pool_seed DECIMAL(20, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buy_in_fee DECIMAL(20, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS protocol_fee_percent DECIMAL(5, 2) DEFAULT 15.00 CHECK (protocol_fee_percent >= 0 AND protocol_fee_percent <= 100),
  ADD COLUMN IF NOT EXISTS agent_limit INTEGER DEFAULT 100 CHECK (agent_limit > 0),
  ADD COLUMN IF NOT EXISTS winner_count INTEGER DEFAULT 3 CHECK (winner_count > 0),
  ADD COLUMN IF NOT EXISTS payout_structure JSONB DEFAULT '{"1": 50, "2": 30, "3": 20}',
  ADD COLUMN IF NOT EXISTS banner_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS current_participants INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_pool_size DECIMAL(20, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_start_time TIMESTAMPTZ;

-- Create arena payouts table for tracking prize distributions
CREATE TABLE IF NOT EXISTS arena_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID,
  rank INTEGER NOT NULL,
  prize_amount DECIMAL(20, 2) NOT NULL,
  payout_percent DECIMAL(5, 2) NOT NULL,
  payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'processing', 'completed', 'failed')),
  payment_method VARCHAR(50) DEFAULT 'internal' CHECK (payment_method IN ('internal', 'usdt_contract')),
  transaction_hash VARCHAR(255),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(round_id, agent_id)
);

-- ============================================
-- PHASE 2: Agent Risk Management Fields
-- ============================================

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS leverage DECIMAL(5, 2) DEFAULT 1.00 CHECK (leverage >= 1 AND leverage <= 50),
  ADD COLUMN IF NOT EXISTS stop_loss_percent DECIMAL(5, 2) CHECK (stop_loss_percent >= 0 AND stop_loss_percent <= 100),
  ADD COLUMN IF NOT EXISTS stop_loss_position_close_percent DECIMAL(5, 2) DEFAULT 100.00 CHECK (stop_loss_position_close_percent > 0 AND stop_loss_position_close_percent <= 100),
  ADD COLUMN IF NOT EXISTS take_profit_percent DECIMAL(5, 2) CHECK (take_profit_percent >= 0),
  ADD COLUMN IF NOT EXISTS take_profit_position_close_percent DECIMAL(5, 2) CHECK (take_profit_position_close_percent > 0 AND take_profit_position_close_percent <= 100),
  ADD COLUMN IF NOT EXISTS risk_reward_ratio DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS avatar_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS llm_model VARCHAR(100) DEFAULT 'claude-3.5-sonnet',
  ADD COLUMN IF NOT EXISTS trading_style VARCHAR(50) DEFAULT 'normal' CHECK (trading_style IN ('paper_hands', 'normal', 'degen'));

-- ============================================
-- Additional Fields for Future Features
-- ============================================

-- Add fields to positions table for leverage tracking
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS leverage DECIMAL(5, 2) DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS liquidation_price DECIMAL(20, 8),
  ADD COLUMN IF NOT EXISTS stop_loss_price DECIMAL(20, 8),
  ADD COLUMN IF NOT EXISTS take_profit_price DECIMAL(20, 8),
  ADD COLUMN IF NOT EXISTS position_type VARCHAR(20) DEFAULT 'long' CHECK (position_type IN ('long', 'short'));

-- ============================================
-- Indexes for Performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_arena_rounds_arena_type ON arena_rounds(arena_type);
CREATE INDEX IF NOT EXISTS idx_arena_rounds_scheduled_start ON arena_rounds(scheduled_start_time);
CREATE INDEX IF NOT EXISTS idx_arena_payouts_round ON arena_payouts(round_id);
CREATE INDEX IF NOT EXISTS idx_arena_payouts_agent ON arena_payouts(agent_id);
CREATE INDEX IF NOT EXISTS idx_arena_payouts_status ON arena_payouts(payment_status);
CREATE INDEX IF NOT EXISTS idx_agents_is_active ON agents(is_active);
CREATE INDEX IF NOT EXISTS idx_agents_is_locked ON agents(is_locked);

-- ============================================
-- Comments for Documentation
-- ============================================

COMMENT ON COLUMN arena_rounds.arena_type IS 'Tournament (scheduled, pre-registration) or Contest (quick match, 2-min)';
COMMENT ON COLUMN arena_rounds.prize_pool_seed IS 'Initial seed money added to prize pool by platform';
COMMENT ON COLUMN arena_rounds.buy_in_fee IS 'Entry fee per agent in USDT';
COMMENT ON COLUMN arena_rounds.protocol_fee_percent IS 'Platform fee percentage taken from total buy-ins';
COMMENT ON COLUMN arena_rounds.payout_structure IS 'JSON object mapping rank to percentage. Example: {"1": 50, "2": 30, "3": 20}';
COMMENT ON COLUMN arena_rounds.current_pool_size IS 'Calculated: prize_pool_seed + (current_participants × buy_in_fee × (1 - protocol_fee_percent/100))';

COMMENT ON COLUMN agents.leverage IS 'Trading leverage multiplier (1-50x). Amplifies both gains and losses';
COMMENT ON COLUMN agents.stop_loss_percent IS 'Auto-close position when loss reaches this % from entry';
COMMENT ON COLUMN agents.stop_loss_position_close_percent IS 'What % of position to close when SL triggers (default 100%)';
COMMENT ON COLUMN agents.take_profit_percent IS 'Auto-close position when profit reaches this % from entry';
COMMENT ON COLUMN agents.is_active IS 'Agent is currently running and processing ticks';
COMMENT ON COLUMN agents.is_locked IS 'Agent is locked in an active arena and cannot be edited';
COMMENT ON COLUMN agents.trading_style IS 'Personality preset: paper_hands (risk-averse), normal (balanced), degen (high-risk)';

COMMENT ON TABLE arena_payouts IS 'Tracks prize distributions to winners. Records both internal credits and blockchain payouts';
