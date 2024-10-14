import { Module } from '@nestjs/common';
import { ApiConfigService } from '@stacks-monorepo/common/config';
import { GasServiceContract } from '@stacks-monorepo/common/contracts/gas-service.contract';
import { ItsContract } from '@stacks-monorepo/common/contracts/its.contract';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { DynamicModuleUtils } from '@stacks-monorepo/common/utils';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksMainnet, StacksNetwork, StacksTestnet } from '@stacks/network';
import { CONSTANTS } from '../utils/constants.enum';
import { GatewayContract } from './gateway.contract';

@Module({
  imports: [DynamicModuleUtils.getRedisModule()],
  providers: [
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
        return new GatewayContract(
          apiConfigService.getContractGateway(),
          apiConfigService.getGatewayContractName(),
          network,
        );
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK],
    },
    {
      provide: GasServiceContract,
      useFactory: async (apiConfigService: ApiConfigService, network: StacksNetwork) => {
        return new GasServiceContract(
          apiConfigService.getContractGasService(),
          apiConfigService.getGasServiceContractName(),
          network,
        );
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK],
    },
    {
      provide: ItsContract,
      useFactory: async (apiConfigService: ApiConfigService, network: StacksNetwork) => {
        return new ItsContract(apiConfigService.getContractIts(), apiConfigService.getItsContractName(), network);
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK],
    },
    {
      provide: ProviderKeys.WALLET_SIGNER,
      useFactory: (apiConfigService: ApiConfigService) => {
        return apiConfigService.getWalletPrivateKey();
      },
      inject: [ApiConfigService],
    },
    TransactionsHelper,
  ],
  exports: [
    GatewayContract,
    GasServiceContract,
    ItsContract,
    ProviderKeys.WALLET_SIGNER,
    TransactionsHelper,
    ProviderKeys.STACKS_NETWORK,
  ],
})
export class ContractsModule {}
