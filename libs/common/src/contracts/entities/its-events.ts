export interface InterchainTokenDeploymentStartedEvent {
  destinationChain: string;
  tokenId: string;
  name: string;
  symbol: string;
  decimals: number;
  minter: string;
}

export interface InterchainTransferEvent {
  tokenId: string;
  sourceAddress: string;
  destinationChain: string;
  destinationAddress: string;
  amount: string;
  data: string;
}
