import { Module } from '@nestjs/common';
import { ApiConfigService } from '@stacks-monorepo/common/config';
import { GasServiceContract } from '@stacks-monorepo/common/contracts/gas-service.contract';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksMainnet, StacksNetwork, StacksTestnet } from '@stacks/network';
import { HelpersModule } from '../helpers/helpers.module';
import { CONSTANTS } from '../utils/constants.enum';
import { GatewayContract } from './gateway.contract';
import { ItsContract } from './ITS/its.contract';
import { TokenManagerContract } from './ITS/token-manager.contract';
import { NativeInterchainTokenContract } from './ITS/native-interchain-token.contract';
import { HiroApiHelper } from '../helpers/hiro.api.helpers';

@Module({
  imports: [HelpersModule],
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
      useFactory: (
        apiConfigService: ApiConfigService,
        network: StacksNetwork,
        transactionsHelper: TransactionsHelper,
      ) => {
        return new GatewayContract(
          apiConfigService.getContractGatewayProxy(),
          apiConfigService.getContractGatewayStorage(),
          network,
          transactionsHelper,
        );
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK, TransactionsHelper],
    },
    {
      provide: GasServiceContract,
      useFactory: (
        apiConfigService: ApiConfigService,
        network: StacksNetwork,
        transactionsHelper: TransactionsHelper,
      ) => {
        return new GasServiceContract(apiConfigService.getContractGasService(), network, transactionsHelper);
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK, TransactionsHelper],
    },
    {
      provide: TokenManagerContract,
      useFactory: (
        apiConfigService: ApiConfigService,
        hiroApiHelper: HiroApiHelper,
        network: StacksNetwork,
        transactionsHelper: TransactionsHelper,
      ) => {
        return new TokenManagerContract(
          apiConfigService.getContractTokenManagerTemplate(),
          hiroApiHelper,
          network,
          transactionsHelper,
        );
      },
      inject: [ApiConfigService, HiroApiHelper, ProviderKeys.STACKS_NETWORK, TransactionsHelper],
    },
    {
      provide: NativeInterchainTokenContract,
      useFactory: (
        apiConfigService: ApiConfigService,
        hiroApiHelper: HiroApiHelper,
        network: StacksNetwork,
        transactionsHelper: TransactionsHelper,
      ) => {
        return new NativeInterchainTokenContract(
          apiConfigService.getContractIdNativeInterchainTokenTemplate(),
          hiroApiHelper,
          network,
          transactionsHelper,
        );
      },
      inject: [ApiConfigService, HiroApiHelper, ProviderKeys.STACKS_NETWORK, TransactionsHelper],
    },
    {
      provide: ItsContract,
      useFactory: (
        apiConfigService: ApiConfigService,
        network: StacksNetwork,
        tokenManager: TokenManagerContract,
        nativeInterchainTokenContract: NativeInterchainTokenContract,
        transactionsHelper: TransactionsHelper,
      ) => {
        return new ItsContract(
          apiConfigService.getContractIts(),
          network,
          tokenManager,
          nativeInterchainTokenContract,
          transactionsHelper,
        );
      },
      inject: [
        ApiConfigService,
        ProviderKeys.STACKS_NETWORK,
        TokenManagerContract,
        NativeInterchainTokenContract,
        TransactionsHelper,
      ],
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
