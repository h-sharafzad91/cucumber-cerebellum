import { config } from '../config/index.js';
import { RiskViolationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { ValidatedAction } from '../types/action.js';
import type { Portfolio } from '../types/tick.js';

interface RiskCheckResult {
  passed: boolean;
  violations: string[];
  warnings: string[];
}

interface AgentRiskState {
  consecutiveLosses: number;
  peakBalance: number;
  isPaused: boolean;
}

export class RiskEngine {
  private agentRiskStates: Map<string, AgentRiskState> = new Map();

  private getAgentRiskState(agentId: string, initialBalance: number): AgentRiskState {
    if (!this.agentRiskStates.has(agentId)) {
      this.agentRiskStates.set(agentId, {
        consecutiveLosses: 0,
        peakBalance: initialBalance,
        isPaused: false,
      });
    }
    return this.agentRiskStates.get(agentId)!;
  }

  updatePeakBalance(agentId: string, currentBalance: number): void {
    const state = this.agentRiskStates.get(agentId);
    if (state && currentBalance > state.peakBalance) {
      state.peakBalance = currentBalance;
    }
  }

  recordTradeResult(agentId: string, isLoss: boolean): void {
    const state = this.agentRiskStates.get(agentId);
    if (!state) return;

    if (isLoss) {
      state.consecutiveLosses++;
      if (state.consecutiveLosses >= config.risk.maxConsecutiveLosses) {
        state.isPaused = true;
        logger.warn(`Circuit breaker triggered for agent ${agentId}: ${state.consecutiveLosses} consecutive losses`);
      }
    } else {
      state.consecutiveLosses = 0;
    }
  }

  resetCircuitBreaker(agentId: string): void {
    const state = this.agentRiskStates.get(agentId);
    if (state) {
      state.isPaused = false;
      state.consecutiveLosses = 0;
      logger.info(`Circuit breaker reset for agent ${agentId}`);
    }
  }

  checkAction(
    action: ValidatedAction,
    portfolio: Portfolio,
    initialBalance: number = config.arena.initialBalance
  ): RiskCheckResult {
    const violations: string[] = [];
    const warnings: string[] = [];

    if (action.action === 'HOLD') {
      return { passed: true, violations: [], warnings: [] };
    }

    const riskState = this.getAgentRiskState(action.agent_id, initialBalance);

    if (riskState.isPaused) {
      violations.push(`Trading paused: circuit breaker triggered after ${config.risk.maxConsecutiveLosses} consecutive losses`);
    }

    if (action.size_usd && action.size_usd > config.arena.maxOrderUsd) {
      violations.push(`Order size ${action.size_usd} exceeds max ${config.arena.maxOrderUsd}`);
    }

    if (action.asset && !config.arena.allowedAssets.includes(action.asset as any)) {
      violations.push(`Asset ${action.asset} not in allowed list`);
    }

    const totalValue = this.calculateTotalPortfolioValue(portfolio);

    const drawdownFromInitial = ((initialBalance - totalValue) / initialBalance) * 100;
    if (drawdownFromInitial >= config.risk.maxDrawdownPercent) {
      violations.push(
        `Drawdown limit exceeded: ${drawdownFromInitial.toFixed(1)}% loss from initial balance (max ${config.risk.maxDrawdownPercent}%)`
      );
    } else if (drawdownFromInitial >= config.risk.maxDrawdownPercent * 0.8) {
      warnings.push(
        `Warning: Approaching drawdown limit (${drawdownFromInitial.toFixed(1)}% of ${config.risk.maxDrawdownPercent}% max)`
      );
    }

    const minBalance = initialBalance * (config.risk.minBalancePercent / 100);
    if (totalValue < minBalance) {
      violations.push(
        `Balance too low: $${totalValue.toFixed(2)} below minimum $${minBalance.toFixed(2)} (${config.risk.minBalancePercent}% of initial)`
      );
    }

    const drawdownFromPeak = ((riskState.peakBalance - totalValue) / riskState.peakBalance) * 100;
    if (drawdownFromPeak >= config.risk.maxDrawdownPercent) {
      violations.push(
        `Peak drawdown limit exceeded: ${drawdownFromPeak.toFixed(1)}% loss from peak balance $${riskState.peakBalance.toFixed(2)}`
      );
    }

    if (action.action === 'BUY_MARKET' && action.size_usd && action.asset) {
      const existingPosition = portfolio.positions.find((p) => p.asset === action.asset);
      const existingValue = existingPosition
        ? existingPosition.size * (existingPosition.current_price || existingPosition.entry_price)
        : 0;
      const newPositionValue = existingValue + action.size_usd;
      const concentration = newPositionValue / (totalValue + action.size_usd);

      const epsilon = 0.0001;
      if (concentration > config.risk.maxPositionConcentration + epsilon) {
        violations.push(
          `Position concentration ${(concentration * 100).toFixed(1)}% exceeds ${config.risk.maxPositionConcentration * 100}% limit`
        );
      }
    }

    if (action.action === 'BUY_MARKET' && action.size_usd) {
      if (portfolio.balance_usd < action.size_usd) {
        violations.push(`Insufficient balance: need ${action.size_usd}, have ${portfolio.balance_usd}`);
      }
    }

    if (action.action === 'SELL_MARKET' && action.asset) {
      const position = portfolio.positions.find((p) => p.asset === action.asset);
      if (!position) {
        violations.push(`No position in ${action.asset} to sell`);
      } else if (action.size_asset) {
        if (position.size < action.size_asset) {
          const diff = action.size_asset - position.size;
          const tolerance = position.size * 0.01;
          if (diff <= tolerance) {
            action.size_asset = position.size;
          } else {
            violations.push(`Insufficient position: have ${position.size} ${action.asset}, want to sell ${action.size_asset}`);
          }
        }
      } else if (action.size_usd) {
        const positionValue = position.size * (position.current_price || position.entry_price);
        if (positionValue < action.size_usd) {
          violations.push(`Position value ${positionValue.toFixed(2)} insufficient for sell of ${action.size_usd}`);
        }
      }
    }

    const passed = violations.length === 0;

    if (!passed) {
      logger.warn({ agentId: action.agent_id, violations }, `Risk check failed for agent ${action.agent_id}`);
    }

    if (warnings.length > 0) {
      logger.info({ agentId: action.agent_id, warnings }, `Risk warnings for agent ${action.agent_id}`);
    }

    return { passed, violations, warnings };
  }

  enforceOrThrow(
    action: ValidatedAction,
    portfolio: Portfolio,
    initialBalance: number = config.arena.initialBalance
  ): void {
    const result = this.checkAction(action, portfolio, initialBalance);

    if (!result.passed) {
      throw new RiskViolationError(
        `Risk violations: ${result.violations.join('; ')}`
      );
    }
  }

  private calculateTotalPortfolioValue(portfolio: Portfolio): number {
    const positionsValue = portfolio.positions.reduce((sum, position) => {
      const price = position.current_price || position.entry_price;
      return sum + position.size * price;
    }, 0);

    return portfolio.balance_usd + positionsValue;
  }

  getRiskMetrics(agentId: string, portfolio: Portfolio, initialBalance: number = config.arena.initialBalance) {
    const riskState = this.getAgentRiskState(agentId, initialBalance);
    const totalValue = this.calculateTotalPortfolioValue(portfolio);

    const drawdownFromInitial = ((initialBalance - totalValue) / initialBalance) * 100;
    const drawdownFromPeak = ((riskState.peakBalance - totalValue) / riskState.peakBalance) * 100;

    return {
      currentValue: totalValue,
      initialBalance,
      peakBalance: riskState.peakBalance,
      drawdownFromInitial: Math.max(0, drawdownFromInitial),
      drawdownFromPeak: Math.max(0, drawdownFromPeak),
      consecutiveLosses: riskState.consecutiveLosses,
      isPaused: riskState.isPaused,
      maxDrawdownAllowed: config.risk.maxDrawdownPercent,
      atRisk: drawdownFromInitial >= config.risk.maxDrawdownPercent * 0.8,
    };
  }
}

export const riskEngine = new RiskEngine();
