import BigNumber from 'bignumber.js';

export interface ContractCallEvent {
  sender: string;
  destinationChain: string;
  destinationAddress: string;
  payloadHash: string;
  payload: Buffer;
}

export interface MessageApprovedEvent {
  commandId: string;
  sourceChain: string;
  messageId: string;
  sourceAddress: string;
  contractAddress: string;
  payloadHash: string;
}

export interface MessageExecutedEvent {
  commandId: string;
  sourceChain: string;
  messageId: string;
}

export interface WeightedSignersEvent {
  signers: {
    signer: string; // ed25519 public key
    weight: BigNumber;
  }[];
  threshold: BigNumber;
  nonce: string; // uint256 as 32 bytes hex,
  epoch: number;
  signersHash: Buffer;
}

export interface GatewayExternalData {
  function: string;
  data: string;
  proof: string;
}
