import BigNumber from 'bignumber.js';

export interface GasPaidForContractCallEvent {
  sender: string;
  amount: BigNumber;
  refundAddress: string;
  destinationChain: string;
  destinationAddress: string;
  payloadHash: string;
}

export interface GasAddedEvent {
  amount: BigNumber;
  refundAddress: string;
  txHash: string;
  logIndex: number;
}

export interface RefundedEvent {
  txHash: string;
  logIndex: number;
  receiver: string;
  amount: BigNumber;
}
