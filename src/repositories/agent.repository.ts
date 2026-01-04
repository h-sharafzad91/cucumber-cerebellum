import { getDatabase } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import type { Agent, CreateAgentInput, UpdateAgentInput, LLMProvider } from '../types/agent.js';

const DEFAULT_WORKER_CONFIG = {
  provider: 'openai' as LLMProvider,
  model: 'gpt-4o-mini',
  temperature: 0,
  max_tokens: 500,
};

const DEFAULT_LLM_MODEL = 'claude-sonnet-4-20250514';

class AgentRepository {
  async findAll(): Promise<Agent[]> {
    const db = getDatabase();
    const { data, error } = await db
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch agents:', error);
      throw error;
    }

    return data || [];
  }

  async findById(id: string): Promise<Agent> {
    const db = getDatabase();
    const { data, error } = await db
      .from('agents')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundError('Agent');
    }

    return data;
  }

  async findByUserId(userId: string): Promise<Agent[]> {
    const db = getDatabase();
    const { data, error } = await db
      .from('agents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error({ error, userId }, 'Failed to fetch agents by user_id - detailed error');
      throw error;
    }

    return data || [];
  }

  async create(input: CreateAgentInput): Promise<Agent> {
    const db = getDatabase();

    const selectedModel = input.llm_model || DEFAULT_LLM_MODEL;

    const agentData = {
      name: input.name,
      user_id: input.user_id || null,
      persona_config: input.persona_config,
      worker_config: {
        ...DEFAULT_WORKER_CONFIG,
        ...input.worker_config,
        model: selectedModel,
      },
      mmr: 1000,
      tick_interval: input.tick_interval || null,
      leverage: input.leverage || 1.0,
      stop_loss_percent: input.stop_loss_percent || null,
      stop_loss_position_close_percent: input.stop_loss_position_close_percent || 100,
      take_profit_percent: input.take_profit_percent || null,
      take_profit_position_close_percent: input.take_profit_position_close_percent || 50,
      risk_reward_ratio: input.risk_reward_ratio || null,
      avatar_id: input.avatar_id || null,
      llm_model: selectedModel,
      trading_style: input.trading_style || 'normal',
      is_active: false,
      is_locked: false,
    };

    const { data, error } = await db
      .from('agents')
      .insert(agentData)
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to create agent');
      throw error;
    }

    logger.info({ agent_id: data.id }, 'Agent created');
    return data;
  }

  async update(id: string, input: UpdateAgentInput): Promise<Agent> {
    const db = getDatabase();

    await this.findById(id);

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name) updateData.name = input.name;
    if (input.persona_config) updateData.persona_config = input.persona_config;
    if (input.worker_config) updateData.worker_config = input.worker_config;
    if (input.tick_interval !== undefined) updateData.tick_interval = input.tick_interval;
    if (input.leverage !== undefined) updateData.leverage = input.leverage;
    if (input.stop_loss_percent !== undefined) updateData.stop_loss_percent = input.stop_loss_percent;
    if (input.stop_loss_position_close_percent !== undefined) updateData.stop_loss_position_close_percent = input.stop_loss_position_close_percent;
    if (input.take_profit_percent !== undefined) updateData.take_profit_percent = input.take_profit_percent;
    if (input.take_profit_position_close_percent !== undefined) updateData.take_profit_position_close_percent = input.take_profit_position_close_percent;
    if (input.trading_style !== undefined) updateData.trading_style = input.trading_style;
    if (input.is_active !== undefined) updateData.is_active = input.is_active;

    const { data, error } = await db
      .from('agents')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update agent:', error);
      throw error;
    }

    logger.info(`Agent updated: ${id}`);
    return data;
  }

  async delete(id: string): Promise<void> {
    const db = getDatabase();

    await this.findById(id);

    const { error } = await db.from('agents').delete().eq('id', id);

    if (error) {
      logger.error('Failed to delete agent:', error);
      throw error;
    }

    logger.info(`Agent deleted: ${id}`);
  }

  async updateMMR(id: string, mmr: number): Promise<void> {
    const db = getDatabase();

    const { error } = await db
      .from('agents')
      .update({ mmr, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      logger.error('Failed to update agent MMR:', error);
      throw error;
    }
  }
}

export const agentRepository = new AgentRepository();
