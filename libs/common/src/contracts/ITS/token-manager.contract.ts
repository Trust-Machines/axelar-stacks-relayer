import { Inject, Injectable, Logger } from '@nestjs/common';
import { StacksNetwork } from '@stacks/network';
import { addressToString, callReadOnlyFunction, ContractPrincipalCV, ResponseOkCV } from '@stacks/transactions';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';

@Injectable()
export class TokenManagerContract {
  private readonly logger = new Logger(TokenManagerContract.name);

  constructor(@Inject(ProviderKeys.STACKS_NETWORK) private readonly network: StacksNetwork) {}

  async getTokenAddress(tokenManagerContract: string) {
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

      return `${addressToString(response.value.address)}.${response.value.contractName.content}`;
    } catch (e) {
      this.logger.error('Failed to call get-token-address');
      this.logger.error(e);
      return null;
    }
  }
}
