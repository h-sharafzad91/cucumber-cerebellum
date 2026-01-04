import { logger } from '../utils/logger.js';
import type { TradeResult } from '../types/action.js';
import type { Position } from '../types/tick.js';

interface PnLResult {
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  positions: Position[];
  balance_usd: number;
}

export class PnLCalculator {
  calculatePnL(
    trade: TradeResult,
    currentPositions: Position[],
    currentBalance: number,
    currentPrice: number
  ): PnLResult {
    let realizedPnl = 0;
    let newBalance = currentBalance;
    const newPositions = [...currentPositions];

    if (trade.status !== 'confirmed') {
      return {
        realized_pnl: 0,
        unrealized_pnl: this.calculateUnrealizedPnL(currentPositions, currentPrice),
        total_pnl: this.calculateUnrealizedPnL(currentPositions, currentPrice),
        positions: currentPositions,
        balance_usd: currentBalance,
      };
    }

    if (trade.action === 'BUY_MARKET') {
      newBalance -= trade.size_usd;

      const existingIdx = newPositions.findIndex((p) => p.asset === trade.asset);
      if (existingIdx >= 0) {
        const existing = newPositions[existingIdx];
        const totalSize = existing.size + trade.size_asset;
        const avgPrice =
          (existing.size * existing.entry_price + trade.size_asset * trade.execution_price) /
          totalSize;

        const unrealizedPnl = totalSize * (currentPrice - avgPrice);
        newPositions[existingIdx] = {
          ...existing,
          size: totalSize,
          entry_price: avgPrice,
          current_price: currentPrice,
          unrealized_pnl: unrealizedPnl,
        };
      } else {
        const unrealizedPnl = trade.size_asset * (currentPrice - trade.execution_price);
        newPositions.push({
          asset: trade.asset,
          size: trade.size_asset,
          entry_price: trade.execution_price,
          current_price: currentPrice,
          unrealized_pnl: unrealizedPnl,
        });
      }
    } else if (trade.action === 'SELL_MARKET') {
      newBalance += trade.size_usd;

      const existingIdx = newPositions.findIndex((p) => p.asset === trade.asset);
      if (existingIdx >= 0) {
        const existing = newPositions[existingIdx];

        realizedPnl = trade.size_asset * (trade.execution_price - existing.entry_price);

        const newSize = existing.size - trade.size_asset;

        if (newSize <= 0.0001) {
          newPositions.splice(existingIdx, 1);
        } else {
          const unrealizedPnl = newSize * (currentPrice - existing.entry_price);
          newPositions[existingIdx] = {
            ...existing,
            size: newSize,
            current_price: currentPrice,
            unrealized_pnl: unrealizedPnl,
          };
        }
      }
    }

    const unrealizedPnl = this.calculateUnrealizedPnL(newPositions, currentPrice);

    return {
      realized_pnl: realizedPnl,
      unrealized_pnl: unrealizedPnl,
      total_pnl: realizedPnl + unrealizedPnl,
      positions: newPositions,
      balance_usd: newBalance,
    };
  }

  calculateUnrealizedPnL(positions: Position[], currentPrice: number): number {
    return positions.reduce((total, position) => {
      const price = position.current_price || currentPrice;
      const unrealized = position.size * (price - position.entry_price);
      return total + unrealized;
    }, 0);
  }

  calculateTotalValue(balance: number, positions: Position[], currentPrice: number): number {
    const positionsValue = positions.reduce((total, position) => {
      const price = position.current_price || currentPrice;
      return total + position.size * price;
    }, 0);

    return balance + positionsValue;
  }
}

export const pnlCalculator = new PnLCalculator();
