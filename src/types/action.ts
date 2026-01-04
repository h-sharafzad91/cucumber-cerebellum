export type ActionType = 'BUY_MARKET' | 'SELL_MARKET' | 'HOLD';

export interface AgentAction {
  agent_id: string;
  tick_id: string;
  reasoning: string;
  action: ActionType;
  asset?: string;
  size_usd?: number;
  size_asset?: number;
  limit_price?: number | null;
}

export interface ValidatedAction extends AgentAction {
  validated_at: string;
  is_valid: boolean;
  validation_errors: string[];
}

export interface TradeResult {
  trade_id: string;
  agent_id: string;
  round_id: string;
  tick_id: string;
  action: ActionType;
  asset: string;
  size_usd: number;
  size_asset: number;
  execution_price: number;
  slippage: number;
  gas_used: string;
  tx_hash: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  error_message?: string;
  created_at: string;
  confirmed_at?: string;
}
