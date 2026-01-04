-- Migration: Add atomic participant update function to prevent race conditions
-- This function ensures that concurrent agent actions don't corrupt participant stats

CREATE OR REPLACE FUNCTION update_participant_atomic(
  p_round_id UUID,
  p_agent_id UUID,
  p_balance_delta DECIMAL(20, 8),
  p_pnl_delta DECIMAL(20, 8),
  p_trades_delta INTEGER,
  p_new_balance DECIMAL(20, 8)
) RETURNS void AS $$
BEGIN
  UPDATE round_participants
  SET
    current_balance = p_new_balance,
    total_pnl = total_pnl + p_pnl_delta,
    total_trades = total_trades + p_trades_delta
  WHERE
    round_id = p_round_id
    AND agent_id = p_agent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant not found: round_id=%, agent_id=%', p_round_id, p_agent_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Add index to improve concurrent update performance
CREATE INDEX IF NOT EXISTS idx_round_participants_round_agent
  ON round_participants(round_id, agent_id);

COMMENT ON FUNCTION update_participant_atomic IS
  'Atomically updates participant stats to prevent race conditions during concurrent agent actions';
