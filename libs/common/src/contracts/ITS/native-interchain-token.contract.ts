import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { buildContractName } from '@stacks-monorepo/common/utils/build-contract-name';
import { StacksNetwork } from '@stacks/network';
import {
  AnchorMode,
  ClarityVersion,
  PostConditionMode,
  SignedContractDeployOptions,
  StacksTransaction,
  TupleCV,
} from '@stacks/transactions';
import { TransactionsHelper } from '../transactions.helper';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { VerifyOnchainContract } from '@stacks-monorepo/common/contracts/ITS/verify-onchain.contract';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

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
    private readonly slackApi: SlackApi,
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

  async getTemplateSourceCode(): Promise<string | null> {
    try {
      if (this.sourceCode) {
        return this.sourceCode;
      }

      this.sourceCode = await this.verifyOnchainContract.getNitSource();

      this.logger.log('Successfully fetched template source code');

      return this.sourceCode;
    } catch (e) {
      this.logger.error('Failed to get source code:', e);
      await this.slackApi.sendError('NIT contract error', 'Failed to get template source code');

      return null;
    }
  }

  async getTemplateDeployVerificationParams(): Promise<TupleCV> {
    if (this.templateDeployVerificationParams) {
      return this.templateDeployVerificationParams;
    }

    try {
      const contractInfo = await this.hiroApiHelper.getContractInfo(this.templateContractId);

      this.templateDeployVerificationParams =
        await this.verifyOnchainContract.buildNativeInterchainTokenVerificationParams(contractInfo.tx_id);

      this.logger.log('Successfully fetched NIT template verification params');

      return this.templateDeployVerificationParams;
    } catch (e) {
      this.logger.error('Failed to get NIT template verification params:', e);
      await this.slackApi.sendError('NIT contract error', 'Failed to get NIT template verification params');

      throw e;
    }
  }

  getTemplateContractId(): string {
    return this.templateContractId;
  }
}
