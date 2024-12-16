import { BroadcastRequest } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';

export interface PendingCosmWasmTransaction {
  request: BroadcastRequest;
  retry: number;
  broadcastID?: string;
  type: 'CONSTRUCT_PROOF' | 'VERIFY';
}
