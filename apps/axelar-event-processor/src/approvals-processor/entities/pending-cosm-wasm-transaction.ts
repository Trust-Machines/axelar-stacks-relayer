import { WasmRequest } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';

export interface PendingCosmWasmTransaction {
  request: WasmRequest;
  retry: number;
  broadcastID?: string;
  type: 'CONSTRUCT_PROOF' | 'VERIFY';
  timestamp: number;
}
