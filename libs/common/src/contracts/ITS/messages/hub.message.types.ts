export interface ReceiveFromHub {
  messageType: number;
  sourceChain: string;
  payload: InterchainTransfer | DeployInterchainToken | DeployTokenManager;
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

export interface DeployTokenManager {
  messageType: number;
  tokenId: string;
  tokenManagerType: number;
  params: string;
}

export enum HubMessageType {
  InterchainTransfer = 0,
  DeployInterchainToken = 1,
  DeployTokenManager = 2,
  SendToHub = 3,
  ReceiveFromHub = 4,
}

export enum VerifyMessageType {
  VERIFY_INTERCHAIN_TOKEN = 'verify-interchain-token',
  VERIFY_TOKEN_MANAGER = 'verify-token-manager',
}
