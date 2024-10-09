import { Module } from '@nestjs/common';
import { GatewayContract } from './gateway.contract';
import { ApiNetworkProvider, ProxyNetworkProvider } from '@multiversx/sdk-network-providers/out';
import { join } from 'path';
import { GasServiceContract } from '@stacks-monorepo/common/contracts/gas-service.contract';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { Mnemonic, UserSigner } from '@multiversx/sdk-wallet/out';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { WegldSwapContract } from '@stacks-monorepo/common/contracts/wegld-swap.contract';
import { ApiConfigModule, ApiConfigService } from '@stacks-monorepo/common/config';
import { DynamicModuleUtils } from '@stacks-monorepo/common/utils';
import { ItsContract } from '@stacks-monorepo/common/contracts/its.contract';
import { StacksTestnet, StacksMainnet, StacksNetwork } from '@stacks/network';
import { CONSTANTS } from '../utils/constants.enum';

@Module({
  imports: [DynamicModuleUtils.getRedisModule()],
  providers: [
    {
      provide: ProxyNetworkProvider,
      useFactory: (apiConfigService: ApiConfigService) => {
        return new ProxyNetworkProvider(apiConfigService.getGatewayUrl(), {
          timeout: apiConfigService.getGatewayTimeout(),
          clientName: 'axelar-mvx-relayer',
        });
      },
      inject: [ApiConfigService],
    },
    {
      provide: ApiNetworkProvider,
      useFactory: (apiConfigService: ApiConfigService) => {
        return new ApiNetworkProvider(apiConfigService.getApiUrl(), {
          timeout: apiConfigService.getApiTimeout(),
          clientName: 'axelar-mvx-relayer',
        });
      },
      inject: [ApiConfigService],
    },
    {
      provide: ProviderKeys.STACKS_NETWORK,
      useFactory: (apiConfigService: ApiConfigService) => {
        if (apiConfigService.getStacksNetwork() === CONSTANTS.NETWORK_MAINNET) {
          return new StacksMainnet();
        }

        return new StacksTestnet();
      },
      inject: [ApiConfigService],
    },
    {
      provide: GatewayContract,
      useFactory: async (apiConfigService: ApiConfigService, network: StacksNetwork) => {
        return new GatewayContract(apiConfigService.getContractGateway(), network);
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK],
    },
    {
      provide: GasServiceContract,
      useFactory: async (apiConfigService: ApiConfigService, network: StacksNetwork) => {
        return new GasServiceContract(apiConfigService.getContractGasService(), network);
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK],
    },
    {
      provide: ItsContract,
      useFactory: async (apiConfigService: ApiConfigService, network: StacksNetwork) => {
        return new ItsContract(apiConfigService.getContractGasService(), network);
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK],
    },
    {
      provide: ProviderKeys.WALLET_SIGNER,
      useFactory: (apiConfigService: ApiConfigService) => {
        const mnemonic = Mnemonic.fromString(apiConfigService.getWalletMnemonic()).deriveKey(0);

        return new UserSigner(mnemonic);
      },
      inject: [ApiConfigService],
    },
    TransactionsHelper,
  ],
  exports: [
    GatewayContract,
    GasServiceContract,
    ItsContract,
    WegldSwapContract,
    ProviderKeys.WALLET_SIGNER,
    ProxyNetworkProvider,
    ApiNetworkProvider,
    TransactionsHelper,
  ],
})
export class ContractsModule {}
