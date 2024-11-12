import { BroadcastRequest } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';

export type ConstructProofPayload = {
  source_chain: string;
  message_id: string;
  source_address: string;
  destination_address: string;
  destination_chain: string;
  payloadHash?: string;
  payload?: string;
};

export interface PendingConstructProof {
  request: BroadcastRequest;
  retry: number;
  broadcastID?: string;
}
