import {
  createWalletClient,
  http,
  type WalletClient,
  type Hash,
  type TransactionRequest,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { ExecutionError } from '../utils/errors.js';

export class SignerService {
  private walletClient: WalletClient;
  private account;

  constructor() {
    this.account = privateKeyToAccount(config.blockchain.signerPrivateKey);

    this.walletClient = createWalletClient({
      account: this.account,
      chain: baseSepolia,
      transport: http(config.blockchain.rpcUrl),
    });

    logger.info(`Signer initialized with address: ${this.account.address}`);
  }

  getAddress(): string {
    return this.account.address;
  }

  async signAndSend(tx: TransactionRequest): Promise<Hash> {
    try {
      logger.info('Signing transaction...');

      const hash = await this.walletClient.sendTransaction({
        account: this.account,
        chain: baseSepolia,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gas,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      });

      logger.info(`Transaction sent: ${hash}`);
      return hash;
    } catch (error) {
      logger.error({ error }, 'Transaction signing failed');
      throw new ExecutionError(
        `Failed to sign transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async signMessage(message: string): Promise<Hash> {
    try {
      const signature = await this.walletClient.signMessage({
        account: this.account,
        message,
      });
      return signature as Hash;
    } catch (error) {
      logger.error({ error }, 'Message signing failed');
      throw new ExecutionError('Failed to sign message');
    }
  }
}

export const signerService = new SignerService();
