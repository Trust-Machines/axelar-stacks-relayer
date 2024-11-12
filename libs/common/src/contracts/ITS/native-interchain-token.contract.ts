import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { buildContractName } from '@stacks-monorepo/common/utils/build-contract-name';
import { StacksNetwork } from '@stacks/network';
import { AnchorMode, optionalCVOf, principalCV, StacksTransaction, stringAsciiCV, uintCV } from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { TransactionsHelper } from '../transactions.helper';
import { DeployInterchainToken } from './messages/hub.message.types';
import { TokenType } from './types/token-type';

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
    try {
      await this.getTemplateSourceCode();
    } catch (error) {
      this.logger.error('Failed to preload source code:', error);
    }
  }

  async getTemplateSourceCode(): Promise<string> {
    if (this.sourceCode) {
      return this.sourceCode;
    }

    return await this.hiroApiHelper.getContractSourceCode(this.templateContractId);
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
    itsContract: string,
  ): Promise<StacksTransaction> {
    return await this.transactionsHelper.makeContractCall({
      contractAddress: contractAddress,
      contractName: contractName,
      functionName: 'setup',
      functionArgs: [
        bufferFromHex(message.tokenId),
        uintCV(TokenType.NATIVE_INTERCHAIN_TOKEN),
        principalCV(itsContract),
        optionalCVOf(), // operator-address
        stringAsciiCV(message.name),
        stringAsciiCV(message.symbol),
        uintCV(message.decimals),
        optionalCVOf(), // token uri
        optionalCVOf(message.minter !== '0x' ? principalCV(message.minter) : undefined),
      ],
      senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });
  }
}
