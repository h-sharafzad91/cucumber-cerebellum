export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'xai';

export type LLMModel =
  | 'gpt-4o-mini'
  | 'gpt-4o'
  | 'gpt-4-turbo'
  | 'claude-sonnet-4-20250514'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-haiku-20241022'
  | 'gemini-2.0-flash'
  | 'gemini-1.5-pro'
  | 'gemini-1.5-flash'
  | 'grok-3'
  | 'grok-3-fast'
  | 'grok-2';

export const AVAILABLE_MODELS_BY_PROVIDER: Record<LLMProvider, { id: LLMModel; name: string; recommended: boolean }[]> = {
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', recommended: true },
    { id: 'gpt-4o', name: 'GPT-4o', recommended: false },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', recommended: false },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', recommended: true },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', recommended: false },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', recommended: false },
  ],
  google: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', recommended: true },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', recommended: false },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', recommended: false },
  ],
  xai: [
    { id: 'grok-3', name: 'Grok 3', recommended: true },
    { id: 'grok-3-fast', name: 'Grok 3 Fast', recommended: false },
    { id: 'grok-2', name: 'Grok 2', recommended: false },
  ],
};

export interface Agent {
  id: string;
  user_id: string | null;
  name: string;
  persona_config: PersonaConfig;
  worker_config: WorkerConfig;
  mmr: number;
  tick_interval?: number;
  leverage?: number;
  stop_loss_percent?: number;
  stop_loss_position_close_percent?: number;
  take_profit_percent?: number;
  take_profit_position_close_percent?: number;
  risk_reward_ratio?: number;
  avatar_id?: string;
  is_locked?: boolean;
  llm_model?: LLMModel;
  trading_style?: 'paper_hands' | 'normal' | 'degen';
  created_at: string;
  updated_at?: string;
}

export interface PersonaConfig {
  strategy: 'momentum' | 'mean_reversion' | 'breakout' | 'custom';
  risk_tolerance: 'conservative' | 'moderate' | 'aggressive';
  goal?: string;
  description?: string;
}

export interface WorkerConfig {
  provider?: LLMProvider;
  model: string;
  temperature: number;
  max_tokens: number;
}

export interface CreateAgentInput {
  name: string;
  persona_config: PersonaConfig;
  worker_config?: Partial<WorkerConfig>;
  user_id?: string;
  tick_interval?: number;
  leverage?: number;
  stop_loss_percent?: number;
  stop_loss_position_close_percent?: number;
  take_profit_percent?: number;
  take_profit_position_close_percent?: number;
  risk_reward_ratio?: number;
  avatar_id?: string;
  llm_model?: string;
  trading_style?: 'paper_hands' | 'normal' | 'degen';
}

export interface UpdateAgentInput {
  name?: string;
  persona_config?: Partial<PersonaConfig>;
  worker_config?: Partial<WorkerConfig>;
  tick_interval?: number;
  leverage?: number;
  stop_loss_percent?: number;
  stop_loss_position_close_percent?: number;
  take_profit_percent?: number;
  take_profit_position_close_percent?: number;
  trading_style?: 'paper_hands' | 'normal' | 'degen';
}
