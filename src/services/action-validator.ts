import { z } from 'zod';
import { config } from '../config/index.js';
import { ValidationError, RiskViolationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { AgentAction, ValidatedAction } from '../types/action.js';
import type { Portfolio } from '../types/tick.js';

const actionSchema = z.object({
  agent_id: z.string().uuid(),
  tick_id: z.string().uuid(),
  reasoning: z.string().max(2000),
  action: z.enum(['BUY_MARKET', 'SELL_MARKET', 'SHORT_MARKET', 'COVER_MARKET', 'HOLD']),
  asset: z.string().nullable().optional(),
  size_usd: z.number().positive().max(config.arena.maxOrderUsd).nullable().optional(),
  size_asset: z.number().positive().nullable().optional(),
  limit_price: z.number().positive().nullable().optional(),
});

export class ActionValidator {
  validate(action: AgentAction, portfolio: Portfolio): ValidatedAction {
    const errors: string[] = [];
    const validatedAt = new Date().toISOString();

    const parseResult = actionSchema.safeParse(action);
    if (!parseResult.success) {
      errors.push(...parseResult.error.errors.map((e) => e.message));
    }

    if (action.action === 'HOLD') {
      return {
        ...action,
        validated_at: validatedAt,
        is_valid: errors.length === 0,
        validation_errors: errors,
      };
    }

    if (action.action === 'BUY_MARKET' || action.action === 'SELL_MARKET') {
      if (!action.asset) {
        errors.push('Asset is required for BUY/SELL actions');
      } else if (!config.arena.allowedAssets.includes(action.asset as any)) {
        errors.push(`Asset ${action.asset} is not allowed. Allowed: ${config.arena.allowedAssets.join(', ')}`);
      }

      if (action.action === 'BUY_MARKET') {
        if (!action.size_usd) {
          errors.push('size_usd is required for BUY actions');
        } else if (action.size_usd > config.arena.maxOrderUsd) {
          errors.push(`Order size ${action.size_usd} exceeds max ${config.arena.maxOrderUsd}`);
        }

        if (action.size_usd && portfolio.balance_usd < action.size_usd) {
          errors.push(`Insufficient balance: ${portfolio.balance_usd} < ${action.size_usd}`);
        }
      }

      if (action.action === 'SELL_MARKET') {
        if (!action.size_asset && !action.size_usd) {
          errors.push('size_asset or size_usd is required for SELL actions');
        }

        if (action.asset) {
          const position = portfolio.positions.find((p) => p.asset === action.asset && p.direction !== 'short');
          if (!position) {
            errors.push(`No position found for ${action.asset}`);
          } else if (action.size_asset && position.size < action.size_asset) {
            const diff = action.size_asset - position.size;
            const tolerance = position.size * 0.01;
            if (diff <= tolerance) {
              action.size_asset = position.size;
              logger.info(`Auto-adjusted sell size from ${action.size_asset + diff} to ${position.size} for agent ${action.agent_id}`);
            } else {
              errors.push(`Insufficient position: ${position.size} ${action.asset} < ${action.size_asset} ${action.asset}`);
            }
          }
        }
      }
    }

    if (action.action === 'SHORT_MARKET') {
      if (!action.asset) {
        errors.push('Asset is required for SHORT actions');
      } else if (!config.arena.allowedAssets.includes(action.asset as any)) {
        errors.push(`Asset ${action.asset} is not allowed. Allowed: ${config.arena.allowedAssets.join(', ')}`);
      }

      if (!action.size_usd) {
        errors.push('size_usd is required for SHORT actions');
      } else if (action.size_usd > config.arena.maxOrderUsd) {
        errors.push(`Order size ${action.size_usd} exceeds max ${config.arena.maxOrderUsd}`);
      }

      if (action.size_usd && portfolio.balance_usd < action.size_usd) {
        errors.push(`Insufficient balance: ${portfolio.balance_usd} < ${action.size_usd}`);
      }

      if (action.asset) {
        const longPosition = portfolio.positions.find((p) => p.asset === action.asset && p.direction !== 'short');
        if (longPosition) {
          errors.push(`Cannot short ${action.asset} while holding a long position`);
        }
      }
    }

    if (action.action === 'COVER_MARKET') {
      if (!action.asset) {
        errors.push('Asset is required for COVER actions');
      } else if (!config.arena.allowedAssets.includes(action.asset as any)) {
        errors.push(`Asset ${action.asset} is not allowed. Allowed: ${config.arena.allowedAssets.join(', ')}`);
      }

      if (!action.size_asset) {
        errors.push('size_asset is required for COVER actions');
      }

      if (action.asset) {
        const shortPosition = portfolio.positions.find((p) => p.asset === action.asset && p.direction === 'short');
        if (!shortPosition) {
          errors.push(`No short position found for ${action.asset}`);
        } else if (action.size_asset && shortPosition.size < action.size_asset) {
          const diff = action.size_asset - shortPosition.size;
          const tolerance = shortPosition.size * 0.01;
          if (diff <= tolerance) {
            action.size_asset = shortPosition.size;
            logger.info(`Auto-adjusted cover size from ${action.size_asset + diff} to ${shortPosition.size} for agent ${action.agent_id}`);
          } else {
            errors.push(`Insufficient short position: ${shortPosition.size} ${action.asset} < ${action.size_asset} ${action.asset}`);
          }
        }
      }
    }

    const isValid = errors.length === 0;

    if (!isValid) {
      logger.warn(`Action validation failed for agent ${action.agent_id}:`, errors);
    }

    return {
      ...action,
      validated_at: validatedAt,
      is_valid: isValid,
      validation_errors: errors,
    };
  }

  validateOrThrow(action: AgentAction, portfolio: Portfolio): ValidatedAction {
    const result = this.validate(action, portfolio);

    if (!result.is_valid) {
      throw new ValidationError(
        'Action validation failed',
        result.validation_errors
      );
    }

    return result;
  }
}

export const actionValidator = new ActionValidator();
