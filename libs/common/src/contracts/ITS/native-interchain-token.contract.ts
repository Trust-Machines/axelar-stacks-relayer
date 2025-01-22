import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { buildContractName } from '@stacks-monorepo/common/utils/build-contract-name';
import { StacksNetwork } from '@stacks/network';
import {
  AnchorMode,
  optionalCVOf,
  principalCV,
  StacksTransaction,
  stringAsciiCV,
  TupleCV,
  uintCV,
} from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { TransactionsHelper } from '../transactions.helper';
import { DeployInterchainToken, ReceiveFromHub } from './messages/hub.message.types';
import { TokenType } from './types/token-type';
import { isEmptyData } from '@stacks-monorepo/common/utils/is-emtpy-data';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { VerifyOnchainContract } from '@stacks-monorepo/common/contracts/ITS/verify-onchain.contract';
import { delay } from '@stacks-monorepo/common/utils/await-success';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { Transaction } from '@stacks/blockchain-api-client/src/types';

const SETUP_MAX_RETRY = 3;
const SETUP_DELAY = 300;

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

  async doDeployContract(senderKey: string, name: string) {
    const deployTx = await this.deployContractTransaction(senderKey, name);
    const deployHash = await this.transactionsHelper.sendTransaction(deployTx);
    return await this.transactionsHelper.awaitSuccess(deployHash);
  }

  async doSetupContract(
    senderKey: string,
    smartContractAddress: string,
    smartContractName: string,
    message: ReceiveFromHub,
    retry = 0,
  ): Promise<{
    success: boolean;
    transaction: Transaction | null;
  }> {
    if (retry >= SETUP_MAX_RETRY) {
      throw new Error(`Could not setup ${smartContractAddress}.${smartContractName} after ${retry} retries`);
    }

    try {
      const innerMessage = message.payload as DeployInterchainToken;

      this.logger.error('inner message');

      const setupTx = await this.setupTransaction(senderKey, smartContractAddress, smartContractName, innerMessage);

      this.logger.error('setup tx');
      const setupHash = await this.transactionsHelper.sendTransaction(setupTx);

      this.logger.error('setup hash');
      return await this.transactionsHelper.awaitSuccess(setupHash);
    } catch (e) {
      this.logger.error(`Could not setup ${smartContractAddress}.${smartContractName}. Retrying in ${SETUP_DELAY} ms`);
      this.logger.error(e);

      await delay(SETUP_DELAY);

      return await this.doSetupContract(senderKey, smartContractAddress, smartContractName, message, retry + 1);
    }
  }

  async deployContractTransaction(senderKey: string, name: string) {
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

    return await this.transactionsHelper.makeContractDeploy(txOptions);
  }

  async setupTransaction(
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

  async getTemplateDeployVerificationParams() {
    try {
      if (this.templateDeployVerificationParams) {
        return this.templateDeployVerificationParams;
      }

      const txId = await this.hiroApiHelper.getContractInfoTxId(this.templateContractId);

      const deployTransaction = await this.hiroApiHelper.getTransaction(txId);

      this.templateDeployVerificationParams = await this.verifyOnchainContract.buildNativeInterchainTokenVerificationParams(deployTransaction);

      this.logger.log('Successfully fetched template verification params');

      return this.templateDeployVerificationParams;
    } catch (error) {
      this.logger.error('Failed to get verification params:');
      this.logger.error(error);
      return null;
    }
  }

  getTemplaceContractId(): string {
    return this.templateContractId;
  }
}
