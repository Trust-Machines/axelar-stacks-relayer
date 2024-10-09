import BigNumber from 'bignumber.js';

export interface GasPaidForContractCallEvent {
  sender: string;
  destinationChain: string;
  destinationAddress: string;
  data: {
    payloadHash: string;
    gasToken: string | null; // null if EGLD
    gasFeeAmount: BigNumber;
    refundAddress: string;
  };
}

export interface GasAddedEvent {
  txHash: string;
  logIndex: number;
  data: {
    gasToken: string | null; // null if EGLD
    gasFeeAmount: BigNumber;
    refundAddress: string;
  };
}

export interface RefundedEvent {
  txHash: string;
  logIndex: number;
  data: {
    receiver: string;
    token: string | null; // null if EGLD
    amount: BigNumber;
  };
}
