export class CacheInfo {
  key: string = '';
  ttl: number = Constants.oneSecond() * 6;

  static PendingTransaction(hash: string): CacheInfo {
    return {
      key: `pendingTransaction:${hash}`,
      ttl: Constants.oneMinute() * 10,
    };
  }

  static PendingCosmWasmTransaction(id: string): CacheInfo {
    return {
      key: `pendingCosmWasmTransaction:${id}`,
      ttl: Constants.oneMinute() * 10,
    };
  }

  static CrossChainTransactions(): CacheInfo {
    return {
      key: `crossChainTransactions`,
      ttl: Constants.oneWeek(),
    };
  }

  static WalletNonce(address: string): CacheInfo {
    return {
      key: `nonce:${address}`,
      ttl: Constants.oneMinute() * 10,
    };
  }

  static GatewayTxFee(retry: number): CacheInfo {
    return {
      key: `gatewayTxFee:${retry}`,
      ttl: Constants.oneMinute() * 10,
    };
  }

  static TokenInfo(tokenId: string): CacheInfo {
    return {
      key: `tokenInfo:${tokenId}`,
      ttl: Constants.oneDay(),
    };
  }

  static FungibleTokens(tokenAddress: string): CacheInfo {
    return {
      key: `fungibleTokens:${tokenAddress}`,
      ttl: Constants.oneDay(),
    };
  }

  static TokenAddressRaw(tokenManagerContract: string): CacheInfo {
    return {
      key: `tokenAddressRaw:${tokenManagerContract}`,
      ttl: Constants.oneDay(),
    };
  }
}

export class Constants {
  static oneSecond(): number {
    return 1;
  }

  static oneMinute(): number {
    return Constants.oneSecond() * 60;
  }

  static oneHour(): number {
    return Constants.oneMinute() * 60;
  }

  static oneDay(): number {
    return Constants.oneHour() * 24;
  }

  static oneWeek(): number {
    return Constants.oneDay() * 7;
  }
}
