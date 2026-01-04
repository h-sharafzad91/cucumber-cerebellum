import { logger } from '../utils/logger.js';
import type { PositionDirection } from './leverage-calculator.js';

interface Position {
  asset: string;
  size: number;
  entry_price: number;
  current_price?: number;
  position_type?: PositionDirection;
}

interface StopLossCheck {
  shouldTrigger: boolean;
  triggerPrice: number;
  currentPrice: number;
  lossPercent: number;
}

export class StopLossEngine {
  checkStopLoss(
    position: Position,
    currentPrice: number,
    stopLossPercent: number
  ): StopLossCheck {
    const direction: PositionDirection = (position.position_type as PositionDirection) || 'long';
    const triggerPrice = this.calculateSlTriggerPrice(
      position.entry_price,
      stopLossPercent,
      direction
    );

    const shouldTrigger = direction === 'long'
      ? currentPrice <= triggerPrice
      : currentPrice >= triggerPrice;

    const lossPercent = direction === 'long'
      ? ((position.entry_price - currentPrice) / position.entry_price) * 100
      : ((currentPrice - position.entry_price) / position.entry_price) * 100;

    return {
      shouldTrigger,
      triggerPrice,
      currentPrice,
      lossPercent,
    };
  }

  calculateSlTriggerPrice(
    entryPrice: number,
    stopLossPercent: number,
    direction: PositionDirection = 'long'
  ): number {
    const priceMove = entryPrice * (stopLossPercent / 100);

    if (direction === 'long') {
      return entryPrice - priceMove;
    } else {
      return entryPrice + priceMove;
    }
  }

  calculateCloseSize(
    positionSize: number,
    closePercent: number = 100
  ): number {
    return positionSize * (closePercent / 100);
  }

  logStopLossExecution(
    agentId: string,
    asset: string,
    entryPrice: number,
    exitPrice: number,
    stopLossPercent: number,
    closePercent: number
  ): void {
    logger.info({
      agentId,
      asset,
      entryPrice,
      exitPrice,
      stopLossPercent,
      closePercent,
      lossPercent: ((entryPrice - exitPrice) / entryPrice) * 100,
    }, 'Stop-loss triggered');
  }
}

export const stopLossEngine = new StopLossEngine();
