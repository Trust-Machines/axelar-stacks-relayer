import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { buildContractName } from '@stacks-monorepo/common/utils/build-contract-name';
import { StacksNetwork } from '@stacks/network';
import { AnchorMode, optionalCVOf, principalCV, StacksTransaction, stringAsciiCV, uintCV } from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { TransactionsHelper } from '../transactions.helper';
import { DeployInterchainToken } from './messages/hub.message.types';
import { TokenType } from './types/token-type';
import { isEmptyData } from '@stacks-monorepo/common/utils/is-emtpy-data';

@Injectable()
export class NativeInterchainTokenContract implements OnModuleInit {
  private readonly logger = new Logger(NativeInterchainTokenContract.name);
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
      this.logger.error('Failed to get source code:');
      this.logger.error(error);
      return null;
    }
  }

  async deployContract(senderKey: string, name: string) {
    const sourceCode = await this.getTemplateSourceCode();
    if (!sourceCode) {
      throw new Error('Native Interchain Token source code not found');
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
    message: DeployInterchainToken,
  ): Promise<StacksTransaction> {
    return await this.transactionsHelper.makeContractCall({
      contractAddress: contractAddress,
      contractName: contractName,
      functionName: 'setup',
      functionArgs: [
        bufferFromHex(message.tokenId),
        uintCV(TokenType.NATIVE_INTERCHAIN_TOKEN),
        optionalCVOf(), // operator-address
        stringAsciiCV(message.name),
        stringAsciiCV(message.symbol),
        uintCV(message.decimals),
        optionalCVOf(), // token uri
        optionalCVOf(isEmptyData(message.minter) ? undefined : principalCV(message.minter)),
      ],
      senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });
  }

  getTemplaceContractId(): string {
    return this.templateContractId;
  }
}
