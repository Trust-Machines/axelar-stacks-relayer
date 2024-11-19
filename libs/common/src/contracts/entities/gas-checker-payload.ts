import { StacksTransaction } from '@stacks/transactions';

export interface GasCheckerPayload {
  transaction: StacksTransaction;
  deployContract?: boolean;
}
