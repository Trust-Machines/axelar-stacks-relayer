import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { buildContractName } from '@stacks-monorepo/common/utils/build-contract-name';
import { StacksNetwork } from '@stacks/network';
import {
  AnchorMode,
  ClarityVersion,
  optionalCVOf,
  PostConditionMode,
  principalCV,
  SignedContractDeployOptions,
  StacksTransaction,
  stringAsciiCV,
  TupleCV,
  uintCV,
} from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { TransactionsHelper } from '../transactions.helper';
import { DeployInterchainToken } from './messages/hub.message.types';
import { TokenType } from './types/token-type';
import { isEmptyData } from '@stacks-monorepo/common/utils/is-emtpy-data';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { VerifyOnchainContract } from '@stacks-monorepo/common/contracts/ITS/verify-onchain.contract';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';

@Injectable()
export class NativeInterchainTokenContract implements OnModuleInit {
  private readonly logger = new Logger(NativeInterchainTokenContract.name);

  private sourceCode: string | null = null;
  private templateDeployVerificationParams: TupleCV | null = null;

  constructor(
    private readonly templateContractId: string,
    private readonly verifyOnchainContract: VerifyOnchainContract,
    @Inject(ProviderKeys.STACKS_NETWORK) private readonly network: StacksNetwork,
    private readonly transactionsHelper: TransactionsHelper,
    private readonly hiroApiHelper: HiroApiHelper,
  ) {}

  async onModuleInit() {
    await this.getTemplateSourceCode();
    await this.getTemplateDeployVerificationParams();
  }

  async deployContractTransaction(
    senderKey: string,
    name: string,
    simulate: boolean = false,
  ): Promise<{
    transaction: StacksTransaction;
    contractName: string;
  }> {
    const sourceCode = await this.getTemplateSourceCode();
    if (!sourceCode) {
      throw new Error('Native Interchain Token source code not found');
    }

    const contractName = buildContractName(name);

    const txOptions: SignedContractDeployOptions = {
      contractName,
      codeBody: sourceCode,
      senderKey: senderKey,
      network: this.network,
      clarityVersion: ClarityVersion.Clarity3,
      postConditionMode: PostConditionMode.Allow,
      anchorMode: AnchorMode.Any,
    };

    const transaction = await this.transactionsHelper.makeContractDeploy(txOptions, simulate);

    return { transaction, contractName };
  }

  async setupTransaction(
    senderKey: string,
    contractAddress: string,
    contractName: string,
    message: DeployInterchainToken,
    simulate: boolean = false,
  ): Promise<StacksTransaction> {
    return await this.transactionsHelper.makeContractCall(
      {
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
      },
      simulate,
    );
  }

  async getTemplateSourceCode(): Promise<string | null> {
    try {
      if (this.sourceCode) {
        return this.sourceCode;
      }

      this.sourceCode = await this.verifyOnchainContract.getNitSource();

      this.logger.log('Successfully fetched template source code');

      return this.sourceCode;
    } catch (error) {
      this.logger.error('Failed to get source code:');
      this.logger.error(error);
      return null;
    }
  }

  async getTemplateDeployVerificationParams(): Promise<TupleCV> {
    if (this.templateDeployVerificationParams) {
      return this.templateDeployVerificationParams;
    }

    try {
      const txId = await this.hiroApiHelper.getContractInfoTxId(this.templateContractId);

      this.templateDeployVerificationParams =
        await this.verifyOnchainContract.buildNativeInterchainTokenVerificationParams(txId);

      this.logger.log('Successfully fetched NIT template verification params');

      return this.templateDeployVerificationParams;
    } catch (error) {
      this.logger.error('Failed to get NIT template verification params:');
      this.logger.error(error);

      throw error;
    }
  }

  getTemplateContractId(): string {
    return this.templateContractId;
  }
}
