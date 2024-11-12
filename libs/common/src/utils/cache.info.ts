export class CacheInfo {
  key: string = '';
  ttl: number = Constants.oneSecond() * 6;

  static LastTaskUUID(): CacheInfo {
    return {
      key: `lastTaskUUID`,
      ttl: Constants.oneWeek(),
    };
  }

  static PendingTransaction(hash: string): CacheInfo {
    return {
      key: `pendingTransaction:${hash}`,
      ttl: Constants.oneMinute() * 10,
    };
  }

  static PendingConstructProof(id: string): CacheInfo {
    return {
      key: `pendingConstructProof:${id}`,
      ttl: Constants.oneMinute() * 10,
    };
  }

  static CrossChainTransactions(): CacheInfo {
    return {
      key: `crossChainTransactions`,
      ttl: Constants.oneWeek(),
    };
  }

  static ContractLastProcessedEvent(contractId: string): CacheInfo {
    return {
      key: `contractLastProcessedEvent${contractId}`,
      ttl: Constants.oneMonth(),
    };
  }

  static WalletNonce(address: string): CacheInfo {
    return {
      key: `nonce:${address}`,
      ttl: Constants.oneMinute() * 5,
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

  static oneMonth(): number {
    return Constants.oneDay() * 30;
  }
}
