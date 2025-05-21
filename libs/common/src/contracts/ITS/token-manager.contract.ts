import { Inject, Injectable, Logger } from '@nestjs/common';
import { StacksNetwork } from '@stacks/network';
import { addressToString, callReadOnlyFunction, ContractPrincipalCV, ResponseOkCV } from '@stacks/transactions';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { TokenInfo } from '@stacks-monorepo/common/contracts/ITS/types/token.info';
import { TokenType } from '@stacks-monorepo/common/contracts/ITS/types/token-type';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { CacheInfo } from '@stacks-monorepo/common';

@Injectable()
export class TokenManagerContract {
  private readonly logger = new Logger(TokenManagerContract.name);

  constructor(
    @Inject(ProviderKeys.STACKS_NETWORK) private readonly network: StacksNetwork,
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly slackApi: SlackApi,
    private readonly redisHelper: RedisHelper,
  ) {}

  async getTokenAddress(tokenInfo: TokenInfo) {
    if (tokenInfo.tokenType === TokenType.NATIVE_INTERCHAIN_TOKEN) {
      return tokenInfo.managerAddress;
    }

    return await this.getTokenAddressRaw(tokenInfo.managerAddress);
  }

  async getTokenContractFungibleTokens(tokenAddress: string): Promise<{ name: string }[] | null> {
    let fungibleTokens = await this.redisHelper.get<{ name: string }[]>(CacheInfo.FungibleTokens(tokenAddress).key);

    if (!fungibleTokens) {
      try {
        const contractInfo = await this.hiroApiHelper.getContractInfo(tokenAddress);

        // Get fungible tokens from ABI since there is no other way to get this using the api
        fungibleTokens = contractInfo?.abi?.fungible_tokens || null;

        await this.redisHelper.set(
          CacheInfo.FungibleTokens(tokenAddress).key,
          fungibleTokens,
          CacheInfo.FungibleTokens(tokenAddress).ttl,
        );
      } catch (e) {
        this.logger.warn(`Failed to get token symbol for token ${tokenAddress}`, e);
        await this.slackApi.sendWarn(
          'Token Manager contract error',
          `Failed to get token symbol for token ${tokenAddress}`,
        );

        return null;
      }
    }

    return fungibleTokens as { name: string }[] | null;
  }

  private async getTokenAddressRaw(tokenManagerContract: string) {
    let tokenAddressRaw = await this.redisHelper.get<string>(CacheInfo.TokenAddressRaw(tokenManagerContract).key);

    if (!tokenAddressRaw) {
      try {
        const contractSplit = tokenManagerContract.split('.');
        const clarityValue = await callReadOnlyFunction({
          contractAddress: contractSplit[0],
          contractName: contractSplit[1],
          functionName: 'get-token-address',
          functionArgs: [],
          network: this.network,
          senderAddress: contractSplit[0],
        });

        const response = clarityValue as ResponseOkCV<ContractPrincipalCV>;

        tokenAddressRaw = `${addressToString(response.value.address)}.${response.value.contractName.content}`;

        await this.redisHelper.set<string>(
          CacheInfo.TokenAddressRaw(tokenManagerContract).key,
          tokenAddressRaw,
          CacheInfo.TokenAddressRaw(tokenManagerContract).ttl,
        );
      } catch (e) {
        this.logger.warn(`Failed to call get-token-address on token manager contract ${tokenManagerContract}`, e);
        await this.slackApi.sendWarn(
          'Token Manager contract error',
          `Failed to call get-token-address on token manager contract ${tokenManagerContract}`,
        );

        return null;
      }
    }

    return tokenAddressRaw;
  }
}
