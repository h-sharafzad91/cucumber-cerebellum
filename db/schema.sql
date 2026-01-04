-- Cucumber Trade Arena Database Schema
-- Based on DevDoc.pdf specifications

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents table
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT,
  name VARCHAR(255) NOT NULL,
  persona_config JSONB NOT NULL DEFAULT '{}',
  worker_config JSONB NOT NULL DEFAULT '{}',
  mmr INTEGER DEFAULT 1000,
  tick_interval INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Arena rounds table
CREATE TABLE arena_rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  min_tick_interval INTEGER NOT NULL,
  max_tick_interval INTEGER NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_tick_interval_range CHECK (min_tick_interval <= max_tick_interval)
);

-- Round participants table
CREATE TABLE round_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  initial_balance DECIMAL(20, 8) NOT NULL DEFAULT 10000,
  current_balance DECIMAL(20, 8) NOT NULL DEFAULT 10000,
  total_pnl DECIMAL(20, 8) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  effective_tick_interval INTEGER NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(round_id, agent_id)
);

-- Ticks table (market snapshots)
CREATE TABLE ticks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  tick_number INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  market_snapshot JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent ticks table (agent state per tick)
CREATE TABLE agent_ticks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tick_timestamp TIMESTAMPTZ NOT NULL,
  state_snapshot JSONB NOT NULL DEFAULT '{}',
  action_taken JSONB NOT NULL DEFAULT '{}',
  raw_reasoning TEXT,
  pnl_impact DECIMAL(20, 8) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trades table
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  tick_id UUID,
  action VARCHAR(50) NOT NULL,
  asset VARCHAR(20) NOT NULL,
  size_usd DECIMAL(20, 8) NOT NULL,
  size_asset DECIMAL(20, 8) NOT NULL,
  execution_price DECIMAL(20, 8) NOT NULL,
  slippage DECIMAL(10, 6) DEFAULT 0,
  gas_used VARCHAR(50),
  tx_hash VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

-- Positions table
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  asset VARCHAR(20) NOT NULL,
  size DECIMAL(20, 8) NOT NULL,
  entry_price DECIMAL(20, 8) NOT NULL,
  current_price DECIMAL(20, 8),
  unrealized_pnl DECIMAL(20, 8) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, round_id, asset)
);

-- Indexes for performance
CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_arena_rounds_status ON arena_rounds(status);
CREATE INDEX idx_round_participants_round ON round_participants(round_id);
CREATE INDEX idx_round_participants_agent ON round_participants(agent_id);
CREATE INDEX idx_ticks_round ON ticks(round_id);
CREATE INDEX idx_agent_ticks_round ON agent_ticks(round_id);
CREATE INDEX idx_agent_ticks_agent ON agent_ticks(agent_id);
CREATE INDEX idx_trades_round ON trades(round_id);
CREATE INDEX idx_trades_agent ON trades(agent_id);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_positions_agent_round ON positions(agent_id, round_id);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_arena_rounds_updated_at
  BEFORE UPDATE ON arena_rounds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_positions_updated_at
  BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
