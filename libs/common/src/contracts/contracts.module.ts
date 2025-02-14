import { forwardRef, Module } from '@nestjs/common';
import { ApiConfigService } from '@stacks-monorepo/common/config';
import { GasServiceContract } from '@stacks-monorepo/common/contracts/gas-service.contract';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksMainnet, StacksNetwork, StacksTestnet } from '@stacks/network';
import { HelpersModule } from '../helpers/helpers.module';
import { CONSTANTS } from '../utils/constants.enum';
import { GatewayContract } from './gateway.contract';
import { ItsContract } from './ITS/its.contract';
import { NativeInterchainTokenContract } from './ITS/native-interchain-token.contract';
import { HiroApiHelper } from '../helpers/hiro.api.helpers';
import { TokenManagerContract } from '@stacks-monorepo/common/contracts/ITS/token-manager.contract';
import { VerifyOnchainContract } from '@stacks-monorepo/common/contracts/ITS/verify-onchain.contract';
import { ApiModule } from '@stacks-monorepo/common/api';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

@Module({
  imports: [HelpersModule, forwardRef(() => ApiModule)],
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
        return new GasServiceContract(
          apiConfigService.getContractGasServiceProxy(),
          apiConfigService.getContractGasServiceStorage(),
          network,
          transactionsHelper,
        );
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK, TransactionsHelper],
    },
    {
      provide: VerifyOnchainContract,
      useFactory: (
        apiConfigService: ApiConfigService,
        network: StacksNetwork,
        hiroApiHelper: HiroApiHelper,
        slackApi: SlackApi,
      ) => {
        return new VerifyOnchainContract(apiConfigService.getContractVerifyOnchain(), network, hiroApiHelper, slackApi);
      },
      inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK, HiroApiHelper, SlackApi],
    },
    {
      provide: NativeInterchainTokenContract,
      useFactory: (
        apiConfigService: ApiConfigService,
        verifyOnchainContract: VerifyOnchainContract,
        network: StacksNetwork,
        transactionsHelper: TransactionsHelper,
        hiroApiHelper: HiroApiHelper,
        slackApi: SlackApi,
      ) => {
        return new NativeInterchainTokenContract(
          apiConfigService.getContractIdNativeInterchainTokenTemplate(),
          verifyOnchainContract,
          network,
          transactionsHelper,
          hiroApiHelper,
          slackApi,
        );
      },
      inject: [
        ApiConfigService,
        VerifyOnchainContract,
        ProviderKeys.STACKS_NETWORK,
        TransactionsHelper,
        HiroApiHelper,
        SlackApi,
      ],
    },
    {
      provide: ItsContract,
      useFactory: (
        apiConfigService: ApiConfigService,
        network: StacksNetwork,
        tokenManager: TokenManagerContract,
        nativeInterchainTokenContract: NativeInterchainTokenContract,
        transactionsHelper: TransactionsHelper,
        gatewayContract: GatewayContract,
        gasServiceContract: GasServiceContract,
        verifyOnchain: VerifyOnchainContract,
        slackApi: SlackApi,
      ) => {
        return new ItsContract(
          apiConfigService.getContractItsProxy(),
          apiConfigService.getContractItsStorage(),
          network,
          tokenManager,
          nativeInterchainTokenContract,
          transactionsHelper,
          gatewayContract,
          gasServiceContract,
          apiConfigService.getAxelarContractIts(),
          verifyOnchain,
          slackApi,
        );
      },
      inject: [
        ApiConfigService,
        ProviderKeys.STACKS_NETWORK,
        TokenManagerContract,
        NativeInterchainTokenContract,
        TransactionsHelper,
        GatewayContract,
        GasServiceContract,
        VerifyOnchainContract,
        SlackApi,
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
    TokenManagerContract,
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
