import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiConfigService {
  constructor(private readonly configService: ConfigService) {}

  getApiUrl(): string {
    const apiUrl = this.configService.get<string>('API_URL');
    if (!apiUrl) {
      throw new Error('No API url present');
    }

    return apiUrl;
  }

  getHiroWsUrl(): string {
    const hiroUrl = this.configService.get<string>('HIRO_WS_URL');
    if (!hiroUrl) {
      throw new Error('No HIRO WS url present');
    }

    return hiroUrl;
  }

  getHiroApiUrl(): string {
    const hiroUrl = this.configService.get<string>('HIRO_API_URL');
    if (!hiroUrl) {
      throw new Error('No HIRO API url present');
    }

    return hiroUrl;
  }

  getRedisUrl(): string {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new Error('No redisUrl present');
    }

    return redisUrl;
  }

  getRedisPort(): number {
    const url = this.getRedisUrl();
    const components = url.split(':');

    if (components.length > 1) {
      return Number(components[1]);
    }

    return 6379;
  }

  getEventsNotifierUrl(): string {
    const eventsNotifierUrl = this.configService.get<string>('EVENTS_NOTIFIER_URL');
    if (!eventsNotifierUrl) {
      throw new Error('No Events Notifier url present');
    }

    return eventsNotifierUrl;
  }

  getContractGatewayStorage(): string {
    const contractGatewayStorage = this.configService.get<string>('CONTRACT_ID_GATEWAY_STORAGE');
    if (!contractGatewayStorage) {
      throw new Error('No Contract Gateway Storage present');
    }

    return contractGatewayStorage;
  }

  getContractGatewayProxy(): string {
    const contractGatewayProxy = this.configService.get<string>('CONTRACT_ID_GATEWAY_PROXY');
    if (!contractGatewayProxy) {
      throw new Error('No Contract Gateway Proxy present');
    }

    return contractGatewayProxy;
  }

  getContractGasServiceProxy(): string {
    const contractGasServiceProxy = this.configService.get<string>('CONTRACT_ID_GAS_SERVICE_PROXY');
    if (!contractGasServiceProxy) {
      throw new Error('No Contract Gas Service Proxy present');
    }

    return contractGasServiceProxy;
  }

  getContractGasServiceStorage(): string {
    const contractGasServiceStorage = this.configService.get<string>('CONTRACT_ID_GAS_SERVICE_STORAGE');
    if (!contractGasServiceStorage) {
      throw new Error('No Contract Gas Service Storage present');
    }

    return contractGasServiceStorage;
  }

  getContractItsProxy(): string {
    const contractIts = this.configService.get<string>('CONTRACT_ID_ITS_PROXY');
    if (!contractIts) {
      throw new Error('No Contract ITS Proxy present');
    }

    return contractIts;
  }

  getContractItsStorage(): string {
    const contractItsStorage = this.configService.get<string>('CONTRACT_ID_ITS_STORAGE');
    if (!contractItsStorage) {
      throw new Error('No Contract ITS Storage present');
    }

    return contractItsStorage;
  }

  getContractIdNativeInterchainTokenTemplate(): string {
    const contract = this.configService.get<string>('CONTRACT_ID_NATIVE_INTERCHAIN_TOKEN_TEMPLATE');
    if (!contract) {
      throw new Error('No Contract Native Interchain Token Template present');
    }

    return contract;
  }

  getAxelarContractIts(): string {
    const axelarContractIts = this.configService.get<string>('AXELAR_CONTRACT_ITS');
    if (!axelarContractIts) {
      throw new Error('No Axelar Contract ITS present');
    }

    return axelarContractIts;
  }

  getMultisigProverContract(): string {
    const contract = this.configService.get<string>('AXELAR_MULTISIG_PROVER_CONTRACT');
    if (!contract) {
      throw new Error('No Axelar Multisig Prover present');
    }

    return contract;
  }

  getAxelarGmpApiUrl(): string {
    const axelarGmpApiUrl = this.configService.get<string>('AXELAR_GMP_API_URL');
    if (!axelarGmpApiUrl) {
      throw new Error('No Axelar GMP API url present');
    }

    return axelarGmpApiUrl;
  }

  getClientCert(): string {
    const clientCert = this.configService.get<string>('CLIENT_CERT');
    if (!clientCert) {
      throw new Error('No client cert present');
    }

    return clientCert;
  }

  getClientKey(): string {
    const clientKey = this.configService.get<string>('CLIENT_KEY');
    if (!clientKey) {
      throw new Error('No client key present');
    }

    return clientKey;
  }

  getStacksNetwork(): string {
    const network = this.configService.get<string>('STACKS_NETWORK');
    if (!network) {
      throw new Error('No Stacks Network present');
    }

    return network;
  }

  getWalletPrivateKey(): string {
    const privateKey = this.configService.get<string>('WALLET_PRIVATE_KEY');
    if (!privateKey) {
      throw new Error('No Wallet Private Key present');
    }

    return privateKey;
  }

  getPoolLimit(): number {
    return this.configService.get<number>('CACHING_POOL_LIMIT') ?? 100;
  }

  getProcessTtl(): number {
    return this.configService.get<number>('CACHING_PROCESS_TTL') ?? 60;
  }

  getApiTimeout(): number {
    return this.configService.get<number>('API_TIMEOUT') ?? 30_000; // 30 seconds default
  }

  getGatewayTimeout(): number {
    return this.configService.get<number>('GATEWAY_TIMEOUT') ?? 30_000; // 30 seconds default
  }

  getAvailableGasCheckEnabled(): boolean {
    const value = this.configService.get<string>('AVAILABLE_GAS_CHECK_ENABLED');
    return value === 'true';
  }
}
