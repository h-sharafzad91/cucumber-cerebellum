export interface TickPayload {
  tick_id: string;
  round_id: string;
  agent_id: string;
  tick_number: number;
  timestamp: string;
  market: MarketData;
  portfolio: Portfolio;
  constraints: Constraints;
}

export interface MarketData {
  ETH_USDC: PriceData;
  candles: CandleData;
}

export interface PriceData {
  price: number;
  source: 'pyth' | 'binance';
  confidence?: number;
}

export interface CandleData {
  ETH_USDC: {
    m1: Candle[];
    m5: Candle[];
    h1: Candle[];
  };
}

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Portfolio {
  balance_usd: number;
  positions: Position[];
}

export interface Position {
  asset: string;
  size: number;
  entry_price: number;
  current_price?: number;
  unrealized_pnl?: number;
}

export interface Constraints {
  max_usd_order: number;
  allowed_assets: string[];
}

export interface StoredTick {
  id: string;
  round_id: string;
  agent_id: string;
  tick_timestamp: string;
  state_snapshot: TickPayload;
  action_taken: object;
  raw_reasoning: string;
  pnl_impact: number;
  created_at: string;
}
