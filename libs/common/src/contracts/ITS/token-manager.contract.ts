import { Injectable, Logger } from '@nestjs/common';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { buildContractName } from '@stacks-monorepo/common/utils/build-contract-name';
import { StacksNetwork } from '@stacks/network';
import {
  addressToString,
  AnchorMode,
  callReadOnlyFunction,
  ContractPrincipalCV,
  optionalCVOf,
  principalCV,
  ResponseOkCV,
  StacksTransaction,
  uintCV,
} from '@stacks/transactions';
import { TransactionsHelper } from '../transactions.helper';
import { DeployTokenManager } from './messages/hub.message.types';

@Injectable()
export class TokenManagerContract {
  private readonly logger = new Logger(TokenManagerContract.name);
  private sourceCode: string | null = null;

  constructor(
    private readonly templateContractId: string,
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly network: StacksNetwork,
    private readonly transactionsHelper: TransactionsHelper,
  ) {}

  async onModuleInit() {
    await this.getTemplateSourceCode();
  }

  async getTemplateSourceCode(): Promise<string | null> {
    try {
      if (this.sourceCode) {
        return this.sourceCode;
      }

      this.sourceCode = await this.hiroApiHelper.getContractSourceCode(this.templateContractId);
      return this.sourceCode;
    } catch (error) {
      this.logger.error('Failed to get source code');
      this.logger.error(error);
      return null;
    }
  }

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

      const tokenAddress = `${addressToString(response.value.address)}.${response.value.contractName.content}`;

      return tokenAddress;
    } catch (e) {
      this.logger.error('Failed to call get-token-address');
      this.logger.error(e);
      return null;
    }
  }

  async deployContract(senderKey: string, name: string) {
    const sourceCode = await this.getTemplateSourceCode();
    if (!sourceCode) {
      throw new Error('Token Manager source code not found');
    }

    const txOptions = {
      contractName: buildContractName(name),
      codeBody: sourceCode,
      senderKey: senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
    };

    const transaction = await this.transactionsHelper.makeContractDeploy(txOptions);
    return transaction;
  }

  async setup(
    senderKey: string,
    contractAddress: string,
    contractName: string,
    message: DeployTokenManager,
    itsContract: string,
    tokenAddress: string,
    operator?: string,
  ): Promise<StacksTransaction> {
    return await this.transactionsHelper.makeContractCall({
      contractAddress: contractAddress,
      contractName: contractName,
      functionName: 'setup',
      functionArgs: [
        principalCV(tokenAddress),
        uintCV(message.tokenManagerType),
        principalCV(itsContract),
        operator ? principalCV(operator) : optionalCVOf(),
      ],
      senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });
  }
}
