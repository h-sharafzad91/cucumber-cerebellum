import { logger } from '../utils/logger.js';

export type PositionDirection = 'long' | 'short';

interface LiquidationResult {
  isLiquidated: boolean;
  liquidationPrice: number;
  currentPrice: number;
  pnlPercent: number;
}

export class LeverageCalculator {
  calculateLeveragedPnL(
    entryPrice: number,
    exitPrice: number,
    leverage: number,
    sizeUsd: number,
    direction: PositionDirection = 'long'
  ): number {
    const priceChange = direction === 'long'
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;

    const pnl = sizeUsd * priceChange * leverage;
    return pnl;
  }

  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    direction: PositionDirection = 'long'
  ): number {
    const liquidationThreshold = 0.95;
    const maxLossPercent = (1 / leverage) * liquidationThreshold;

    if (direction === 'long') {
      return entryPrice * (1 - maxLossPercent);
    } else {
      return entryPrice * (1 + maxLossPercent);
    }
  }

  checkLiquidation(
    entryPrice: number,
    currentPrice: number,
    leverage: number,
    direction: PositionDirection = 'long'
  ): LiquidationResult {
    const liquidationPrice = this.calculateLiquidationPrice(entryPrice, leverage, direction);

    const isLiquidated = direction === 'long'
      ? currentPrice <= liquidationPrice
      : currentPrice >= liquidationPrice;

    const pnlPercent = direction === 'long'
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    if (isLiquidated) {
      logger.warn({
        entryPrice,
        currentPrice,
        liquidationPrice,
        leverage,
        direction,
      }, 'Position liquidated');
    }

    return {
      isLiquidated,
      liquidationPrice,
      currentPrice,
      pnlPercent,
    };
  }

  calculatePositionSize(
    balance: number,
    leverage: number,
    riskPercent: number
  ): number {
    const maxRiskAmount = balance * (riskPercent / 100);
    const positionSize = maxRiskAmount * leverage;
    return positionSize;
  }

  calculateRequiredMargin(
    positionSizeUsd: number,
    leverage: number
  ): number {
    return positionSizeUsd / leverage;
  }

  calculateEffectiveLeverage(
    positionValue: number,
    accountBalance: number
  ): number {
    if (accountBalance <= 0) return 0;
    return positionValue / accountBalance;
  }
}

export const leverageCalculator = new LeverageCalculator();
