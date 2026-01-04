import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

class CortexClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.cortex.url;
  }

  async subscribeToRound(roundId: string, agentIds: string[]): Promise<boolean> {
    if (agentIds.length === 0) {
      logger.warn('No agents to subscribe to round', { roundId });
      return true;
    }

    try {
      const response = await fetch(`${this.baseUrl}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_id: roundId,
          agent_ids: agentIds,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error('Failed to subscribe agents to Cortex', { roundId, agentIds, error });
        return false;
      }

      const result = await response.json();
      logger.info('Agents subscribed to Cortex', { roundId, agentIds, result });
      return true;
    } catch (error) {
      logger.error('Error connecting to Cortex', { roundId, error });
      return false;
    }
  }

  async addAgent(agentId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/agents/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error('Failed to add agent to Cortex', { agentId, error });
        return false;
      }

      logger.info('Agent added to Cortex', { agentId });
      return true;
    } catch (error) {
      logger.error('Error adding agent to Cortex', { agentId, error });
      return false;
    }
  }

  async unsubscribe(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/unsubscribe`, {
        method: 'POST',
      });

      if (!response.ok) {
        logger.error('Failed to unsubscribe from Cortex');
        return false;
      }

      logger.info('Unsubscribed from Cortex');
      return true;
    } catch (error) {
      logger.error('Error unsubscribing from Cortex', { error });
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const cortexClient = new CortexClient();
