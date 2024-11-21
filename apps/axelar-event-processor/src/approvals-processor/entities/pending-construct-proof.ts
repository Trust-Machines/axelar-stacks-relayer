import { BroadcastRequest } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';

export interface PendingConstructProof {
  request: BroadcastRequest;
  retry: number;
  broadcastID?: string;
}
