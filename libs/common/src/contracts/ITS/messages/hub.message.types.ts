export interface ReceiveFromHub {
  messageType: number;
  sourceChain: string;
  payload: InterchainTransfer | DeployInterchainToken;
}

export interface InterchainTransfer {
  messageType: number;
  tokenId: string;
  sourceAddress: string;
  destinationAddress: string;
  amount: string;
  data: string;
}

export interface DeployInterchainToken {
  messageType: number;
  tokenId: string;
  name: string;
  symbol: string;
  decimals: number;
  minter: string;
}

export enum HubMessageType {
  InterchainTransfer = 0,
  DeployInterchainToken = 1,
  SendToHub = 3,
  ReceiveFromHub = 4,
}
