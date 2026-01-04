import { logger } from '../utils/logger.js';
import type { PositionDirection } from './leverage-calculator.js';

interface Position {
  asset: string;
  size: number;
  entry_price: number;
  current_price?: number;
  position_type?: PositionDirection;
}

interface TakeProfitCheck {
  shouldTrigger: boolean;
  triggerPrice: number;
  currentPrice: number;
  profitPercent: number;
}

export class TakeProfitEngine {
  checkTakeProfit(
    position: Position,
    currentPrice: number,
    takeProfitPercent: number
  ): TakeProfitCheck {
    const direction: PositionDirection = (position.position_type as PositionDirection) || 'long';
    const triggerPrice = this.calculateTpTriggerPrice(
      position.entry_price,
      takeProfitPercent,
      direction
    );

    const shouldTrigger = direction === 'long'
      ? currentPrice >= triggerPrice
      : currentPrice <= triggerPrice;

    const profitPercent = direction === 'long'
      ? ((currentPrice - position.entry_price) / position.entry_price) * 100
      : ((position.entry_price - currentPrice) / position.entry_price) * 100;

    return {
      shouldTrigger,
      triggerPrice,
      currentPrice,
      profitPercent,
    };
  }

  calculateTpTriggerPrice(
    entryPrice: number,
    takeProfitPercent: number,
    direction: PositionDirection = 'long'
  ): number {
    const priceMove = entryPrice * (takeProfitPercent / 100);

    if (direction === 'long') {
      return entryPrice + priceMove;
    } else {
      return entryPrice - priceMove;
    }
  }

  calculateCloseSize(
    positionSize: number,
    closePercent: number = 100
  ): number {
    return positionSize * (closePercent / 100);
  }

  shouldPartialClose(
    currentProfitPercent: number,
    takeProfitPercent: number,
    closePercent: number
  ): boolean {
    return currentProfitPercent >= takeProfitPercent && closePercent < 100;
  }

  logTakeProfitExecution(
    agentId: string,
    asset: string,
    entryPrice: number,
    exitPrice: number,
    takeProfitPercent: number,
    closePercent: number
  ): void {
    logger.info({
      agentId,
      asset,
      entryPrice,
      exitPrice,
      takeProfitPercent,
      closePercent,
      profitPercent: ((exitPrice - entryPrice) / entryPrice) * 100,
    }, 'Take-profit triggered');
  }
}

export const takeProfitEngine = new TakeProfitEngine();
