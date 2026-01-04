import {
  createPublicClient,
  http,
  parseUnits,
  encodeFunctionData,
  type Hash,
  type Address,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { config } from '../config/index.js';
import { signerService } from './signer.js';
import { logger } from '../utils/logger.js';
import { ExecutionError } from '../utils/errors.js';
import type { ValidatedAction, TradeResult } from '../types/action.js';
import { v4 as uuidv4 } from 'uuid';

const UNISWAP_ROUTER = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as Address;

const TOKENS: Record<string, Address> = {
  ETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const SWAP_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

export class ExecutionEngine {
  private publicClient;

  constructor() {
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(config.blockchain.rpcUrl),
    });
  }

  async executeAction(
    action: ValidatedAction,
    roundId: string,
    currentPrice: number
  ): Promise<TradeResult> {
    const tradeId = uuidv4();
    const createdAt = new Date().toISOString();

    if (action.action === 'HOLD') {
      return {
        trade_id: tradeId,
        agent_id: action.agent_id,
        round_id: roundId,
        tick_id: action.tick_id,
        action: 'HOLD',
        asset: '',
        size_usd: 0,
        size_asset: 0,
        execution_price: 0,
        slippage: 0,
        gas_used: '0',
        tx_hash: '',
        status: 'confirmed',
        created_at: createdAt,
        confirmed_at: createdAt,
      };
    }

    if (config.arena.paperTrading) {
      const isBuy = action.action === 'BUY_MARKET';

      let sizeAsset: number;
      let sizeUsd: number;

      if (isBuy) {
        sizeUsd = action.size_usd || 0;
        sizeAsset = sizeUsd / currentPrice;
      } else {
        sizeAsset = action.size_asset || (action.size_usd ? action.size_usd / currentPrice : 0);
        sizeUsd = sizeAsset * currentPrice;
      }

      logger.info(`[PAPER TRADE] ${action.action} ${action.asset}: ${sizeAsset.toFixed(6)} ${action.asset} ($${sizeUsd.toFixed(2)}) @ $${currentPrice}`);

      return {
        trade_id: tradeId,
        agent_id: action.agent_id,
        round_id: roundId,
        tick_id: action.tick_id,
        action: action.action,
        asset: action.asset!,
        size_usd: sizeUsd,
        size_asset: sizeAsset,
        execution_price: currentPrice,
        slippage: 0,
        gas_used: '0',
        tx_hash: `paper-${tradeId}`,
        status: 'confirmed',
        created_at: createdAt,
        confirmed_at: createdAt,
      };
    }

    try {
      if (action.action === 'BUY_MARKET') {
        await this.ensureApproval(TOKENS.USDC, action.size_usd!);
      }

      const txData = this.buildSwapTransaction(action, currentPrice);
      const gasEstimate = await this.estimateGas(txData);

      const txHash = await signerService.signAndSend({
        to: UNISWAP_ROUTER,
        data: txData.data,
        value: txData.value,
        gas: gasEstimate,
      });

      const receipt = await this.waitForConfirmation(txHash);

      const isBuy = action.action === 'BUY_MARKET';
      let sizeAsset: number;
      let sizeUsd: number;

      if (isBuy) {
        sizeUsd = action.size_usd || 0;
        sizeAsset = sizeUsd / currentPrice;
      } else {
        sizeAsset = action.size_asset || (action.size_usd ? action.size_usd / currentPrice : 0);
        sizeUsd = sizeAsset * currentPrice;
      }

      return {
        trade_id: tradeId,
        agent_id: action.agent_id,
        round_id: roundId,
        tick_id: action.tick_id,
        action: action.action,
        asset: action.asset!,
        size_usd: sizeUsd,
        size_asset: sizeAsset,
        execution_price: currentPrice,
        slippage: 0,
        gas_used: receipt.gasUsed.toString(),
        tx_hash: txHash,
        status: receipt.status === 'success' ? 'confirmed' : 'failed',
        created_at: createdAt,
        confirmed_at: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Trade execution failed:', error);

      return {
        trade_id: tradeId,
        agent_id: action.agent_id,
        round_id: roundId,
        tick_id: action.tick_id,
        action: action.action,
        asset: action.asset || '',
        size_usd: action.size_usd || 0,
        size_asset: 0,
        execution_price: 0,
        slippage: 0,
        gas_used: '0',
        tx_hash: '',
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        created_at: createdAt,
      };
    }
  }

  private buildSwapTransaction(
    action: ValidatedAction,
    currentPrice: number
  ): { data: `0x${string}`; value: bigint } {
    const isBuy = action.action === 'BUY_MARKET';

    const tokenIn = isBuy ? TOKENS.USDC : TOKENS.ETH;
    const tokenOut = isBuy ? TOKENS.ETH : TOKENS.USDC;

    const sizeUsd = action.size_usd || 0;
    const sizeAsset = action.size_asset || (sizeUsd / currentPrice);

    const amountIn = isBuy
      ? parseUnits(sizeUsd.toString(), 6)
      : parseUnits(sizeAsset.toString(), 18);

    const minOutput = isBuy
      ? parseUnits(((sizeUsd / currentPrice) * 0.99).toString(), 18)
      : parseUnits((sizeAsset * currentPrice * 0.99).toString(), 6);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    const data = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn,
          tokenOut,
          fee: 3000,
          recipient: signerService.getAddress() as Address,
          deadline,
          amountIn,
          amountOutMinimum: minOutput,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    return { data, value: 0n };
  }

  private async estimateGas(txData: { data: `0x${string}`; value: bigint }): Promise<bigint> {
    try {
      const estimate = await this.publicClient.estimateGas({
        account: signerService.getAddress() as Address,
        to: UNISWAP_ROUTER,
        data: txData.data,
        value: txData.value,
      });

      return (estimate * 120n) / 100n;
    } catch (error) {
      logger.warn('Gas estimation failed, using default:', error);
      return 300000n;
    }
  }

  private async waitForConfirmation(txHash: Hash) {
    return await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 60000,
    });
  }

  private async ensureApproval(token: Address, amountUsd: number): Promise<void> {
    const owner = signerService.getAddress() as Address;
    const decimals = token === TOKENS.USDC ? 6 : 18;
    const amount = parseUnits(amountUsd.toString(), decimals);

    const allowance = await this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, UNISWAP_ROUTER],
    });

    if (allowance >= amount) {
      logger.info(`Token already approved: ${allowance.toString()}`);
      return;
    }

    logger.info(`Approving token ${token} for Uniswap router...`);
    const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [UNISWAP_ROUTER, maxApproval],
    });

    const txHash = await signerService.signAndSend({
      to: token,
      data: approveData,
      value: 0n,
      gas: 100000n,
    });

    await this.waitForConfirmation(txHash);
    logger.info(`Token approved, tx: ${txHash}`);
  }
}

export const executionEngine = new ExecutionEngine();
