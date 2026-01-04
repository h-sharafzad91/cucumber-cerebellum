import { logger } from '../utils/logger.js';

interface PayoutResult {
  rank: number;
  agentId: string;
  amount: number;
  percentage: number;
}

interface PoolCalculation {
  seedAmount: number;
  buyInContribution: number;
  protocolRevenue: number;
  totalPrizePool: number;
}

export class PrizePoolCalculator {
  calculateDynamicPool(
    seedAmount: number,
    participantCount: number,
    buyInFee: number,
    protocolFeePercent: number
  ): PoolCalculation {
    const totalBuyIns = participantCount * buyInFee;
    const protocolRevenue = totalBuyIns * (protocolFeePercent / 100);
    const buyInContribution = totalBuyIns - protocolRevenue;
    const totalPrizePool = seedAmount + buyInContribution;

    return {
      seedAmount,
      buyInContribution,
      protocolRevenue,
      totalPrizePool,
    };
  }

  calculateProtocolRevenue(
    participantCount: number,
    buyInFee: number,
    protocolFeePercent: number
  ): number {
    const totalBuyIns = participantCount * buyInFee;
    return totalBuyIns * (protocolFeePercent / 100);
  }

  calculatePayouts(
    totalPool: number,
    payoutStructure: Record<string, number>,
    winners: Array<{ rank: number; agentId: string }>
  ): PayoutResult[] {
    const percentageSum = Object.values(payoutStructure).reduce(
      (sum, percent) => sum + percent,
      0
    );

    if (Math.abs(percentageSum - 100) > 0.01) {
      logger.error({
        structure: payoutStructure,
        sum: percentageSum,
      }, 'Payout structure does not sum to 100%');
      throw new Error('Payout structure must sum to 100%');
    }

    const results: PayoutResult[] = [];

    for (const winner of winners) {
      const rankStr = winner.rank.toString();
      const percentage = payoutStructure[rankStr];

      if (!percentage) {
        logger.warn({ rank: winner.rank }, 'No payout percentage defined for rank');
        continue;
      }

      const amount = (totalPool * percentage) / 100;

      results.push({
        rank: winner.rank,
        agentId: winner.agentId,
        amount: Math.round(amount * 100) / 100,
        percentage,
      });
    }

    return results;
  }

  validatePayoutStructure(payoutStructure: Record<string, number>): boolean {
    const percentages = Object.values(payoutStructure);

    if (percentages.length === 0) {
      return false;
    }

    for (const percent of percentages) {
      if (percent < 0 || percent > 100) {
        return false;
      }
    }

    const sum = percentages.reduce((total, percent) => total + percent, 0);

    return Math.abs(sum - 100) < 0.01;
  }

  getMinimumParticipants(winnerCount: number): number {
    return winnerCount;
  }
}

export const prizePoolCalculator = new PrizePoolCalculator();
