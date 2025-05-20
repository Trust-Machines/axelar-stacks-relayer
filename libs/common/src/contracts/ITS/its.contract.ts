import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { splitContractId } from '@stacks-monorepo/common/utils/split-contract-id';
import { StacksNetwork } from '@stacks/network';
import {
  AnchorMode,
  bufferCV,
  callReadOnlyFunction,
  ClarityValue,
  createAssetInfo,
  createFungiblePostCondition,
  createSTXPostCondition,
  cvToJSON,
  cvToString,
  FungibleConditionCode,
  optionalCVOf,
  PostCondition,
  principalCV,
  StacksTransaction,
  stringAsciiCV,
  TupleCV,
} from '@stacks/transactions';
import { TransactionsHelper } from '../transactions.helper';
import { HubMessage } from './messages/hub.message';
import {
  DeployInterchainToken,
  HubMessageType,
  InterchainTransfer,
  ReceiveFromHub,
} from './messages/hub.message.types';
import { NativeInterchainTokenContract } from './native-interchain-token.contract';
import { TokenManagerContract } from './token-manager.contract';
import { TokenInfo } from './types/token.info';
import { isEmptyData } from '@stacks-monorepo/common/utils/is-emtpy-data';
import { GatewayContract } from '../gateway.contract';
import { GasServiceContract } from '../gas-service.contract';
import { GasCheckerPayload } from '../entities/gas-checker-payload';
import { ScEvent } from '../../../../../apps/stacks-event-processor/src/event-processor/types';
import {
  DecodingUtils,
  interchainTokenDeploymentStartedEventDecoder,
  interchainTransferEventDecoder,
} from '@stacks-monorepo/common/utils/decoding.utils';
import {
  InterchainTokenDeploymentStartedEvent,
  InterchainTransferEvent,
} from '@stacks-monorepo/common/contracts/entities/its-events';
import { VerifyOnchainContract } from '@stacks-monorepo/common/contracts/ITS/verify-onchain.contract';
import { BinaryUtils } from '@stacks-monorepo/common';
import { ItsError } from '@stacks-monorepo/common/contracts/entities/its.error';
import { TokenType } from '@stacks-monorepo/common/contracts/ITS/types/token-type';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

export interface ItsExtraData {
  step: 'CONTRACT_DEPLOY' | 'CONTRACT_SETUP' | 'ITS_EXECUTE';
  contractId?: string;
  timestamp?: number; // in milliseconds
  deployTxHash?: string;
}

export interface MessageApprovedData {
  transaction: StacksTransaction | null;
  incrementRetry: boolean;
  extraData: any;
}

@Injectable()
export class ItsContract implements OnModuleInit {
  private readonly logger = new Logger(ItsContract.name);
  private readonly proxyContractAddress;
  private readonly proxyContractName;
  private readonly storageContractAddress;
  private readonly storageContractName;

  private itsImpl: string | null = null;

  constructor(
    proxyContract: string,
    storageContract: string,
    private readonly network: StacksNetwork,
    private readonly tokenManagerContract: TokenManagerContract,
    private readonly nativeInterchainTokenContract: NativeInterchainTokenContract,
    private readonly transactionsHelper: TransactionsHelper,
    private readonly gatewayContract: GatewayContract,
    private readonly gasServiceContract: GasServiceContract,
    private readonly axelarContractIts: string,
    private readonly verifyOnchain: VerifyOnchainContract,
    private readonly slackApi: SlackApi,
  ) {
    [this.proxyContractAddress, this.proxyContractName] = splitContractId(proxyContract);
    [this.storageContractAddress, this.storageContractName] = splitContractId(storageContract);
  }

  async onModuleInit() {
    await this.getItsImpl();
  }

  async getItsImpl(): Promise<string> {
    if (this.itsImpl) {
      return this.itsImpl;
    }

    const result = await callReadOnlyFunction({
      contractAddress: this.storageContractAddress,
      contractName: this.storageContractName,
      functionName: 'get-service-impl',
      functionArgs: [],
      network: this.network,
      senderAddress: this.storageContractAddress,
    });

    this.itsImpl = cvToString(result);

    return this.itsImpl;
  }

  async execute(
    senderKey: string,
    sourceChain: string,
    messageId: string,
    sourceAddress: string,
    destinationAddress: string,
    payloadHex: string,
    availableGasBalance: string,
    executeTxHash: string | null,
    extraData?: ItsExtraData,
  ): Promise<MessageApprovedData> {
    if (sourceChain !== CONSTANTS.AXELAR_CHAIN || sourceAddress !== this.axelarContractIts) {
      this.logger.warn(
        `Received message for Stacks ITS from non ITS Hub contract, NOT handling it. Message ID: ${messageId}, source chain: ${sourceChain}, source address: ${sourceAddress}, destination address: ${destinationAddress}, payload: ${payloadHex}`,
      );
      await this.slackApi.sendWarn(
        'ITS contract error',
        `Received message for Stacks ITS from non ITS Hub contract, NOT handling it. Message ID: ${messageId}, source chain: ${sourceChain}, source address: ${sourceAddress}, destination address: ${destinationAddress}, payload: ${payloadHex}`,
      );

      return { transaction: null, incrementRetry: true, extraData: null };
    }

    this.logger.debug(
      `Executing message with ID: ${messageId}, source chain: ${sourceChain}, source address: ${sourceAddress}, destination address: ${destinationAddress}, payload: ${payloadHex}`,
    );

    const message = HubMessage.abiDecode(payloadHex);
    if (!message) {
      this.logger.fatal(`Could ABI decode ITS message payload ${payloadHex}. This should NOT have happened...`);

      return { transaction: null, incrementRetry: true, extraData: null };
    }

    const innerMessage = message?.payload;

    switch (innerMessage?.messageType) {
      case HubMessageType.InterchainTransfer: {
        const transaction = await this.handleInterchainTransfer(
          senderKey,
          message,
          messageId,
          sourceChain,
          sourceAddress,
          availableGasBalance,
        );

        return { transaction, incrementRetry: true, extraData: null };
      }
      case HubMessageType.DeployInterchainToken:
        return await this.handleDeployNativeInterchainToken(
          senderKey,
          message,
          messageId,
          sourceChain,
          sourceAddress,
          availableGasBalance,
          executeTxHash,
          extraData,
        );
      default:
        this.logger.error(`Unknown message type: ${message?.messageType}`);
        await this.slackApi.sendError('ITS contract error', `Unknown message type: ${message?.messageType}`);

        return {
          transaction: null,
          incrementRetry: true,
          extraData: null,
        };
    }
  }

  async handleInterchainTransfer(
    senderKey: string,
    message: ReceiveFromHub,
    messageId: string,
    sourceChain: string,
    sourceAddress: string,
    availableGasBalance: string,
  ) {
    this.logger.debug(`Handling interchain transfer for message ID: ${messageId}, message: ${JSON.stringify(message)}`);
    const tokenInfo = await this.getTokenInfo(message.payload.tokenId);
    if (!tokenInfo) {
      throw new ItsError(
        `Could not get token info for token id ${message.payload.tokenId}, not yet deployed on Stacks`,
      );
    }

    return await this.executeReceiveInterchainToken(
      senderKey,
      message,
      messageId,
      sourceChain,
      sourceAddress,
      tokenInfo,
      availableGasBalance,
    );
  }

  async handleDeployNativeInterchainToken(
    senderKey: string,
    message: ReceiveFromHub,
    messageId: string,
    sourceChain: string,
    sourceAddress: string,
    availableGasBalance: string,
    executeTxHash: string | null,
    extraData?: ItsExtraData,
  ): Promise<MessageApprovedData> {
    // In case we haven't started deploying anything for this yet, check gas first
    if (!extraData?.step) {
      await this.checkDeployInterchainTokenGasBalance(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
      );

      extraData = {
        step: 'CONTRACT_DEPLOY',
      };
    }

    extraData = extraData as ItsExtraData;
    this.logger.debug(
      `Handling deploy native interchain token for message ID: ${messageId}, message: ${JSON.stringify(message)}, step: ${extraData.step}`,
    );

    // If we have an executeTxHash, the deploy process is in progress so we need to check if the transaction has succeeded
    // before moving forward
    if (executeTxHash) {
      const result = await this.checkPendingTransactionSuccess(executeTxHash, extraData);

      // If transaction is still pending or it has not succeeded, we will exit here
      if (result) {
        return result;
      }
    }

    switch (extraData.step) {
      // @ts-ignore
      case 'CONTRACT_DEPLOY': {
        // Deploy contract if we don't have a transaction hash yet
        if (!executeTxHash) {
          this.logger.debug(`Deploying native interchain token contract...`);

          const innerMessage = message.payload as DeployInterchainToken;
          const { transaction, contractName } = await this.nativeInterchainTokenContract.deployContractTransaction(
            senderKey,
            innerMessage.name,
          );

          return {
            transaction,
            incrementRetry: false,
            extraData: {
              step: 'CONTRACT_DEPLOY',
              contractId: this.transactionsHelper.makeContractId(contractName),
              timestamp: Date.now(),
              deployTxHash: transaction.txid(),
            } as ItsExtraData,
          };
        }

        // Success of transaction is checked above before the switch
        this.logger.debug(`Successfully deployed native interchain contract, txId: ${executeTxHash}`);

        executeTxHash = null;
        // No break here is intentional
      }
      // @ts-ignore
      case 'CONTRACT_SETUP': {
        // Setup contract if we don't have a transaction hash yet
        if (!executeTxHash) {
          const contractId = extraData.contractId as string;

          this.logger.debug(`Calling setup function on the native interchain token contract ${contractId}...`);

          const [smartContractAddress, smartContractName] = splitContractId(contractId);
          const innerMessage = message.payload as DeployInterchainToken;
          const transaction = await this.nativeInterchainTokenContract.setupTransaction(
            senderKey,
            smartContractAddress,
            smartContractName,
            innerMessage,
          );

          return {
            transaction,
            incrementRetry: false,
            extraData: {
              step: 'CONTRACT_SETUP',
              contractId,
              timestamp: Date.now(),
              deployTxHash: extraData.deployTxHash,
            } as ItsExtraData,
          };
        }

        // Success of transaction is checked above before the switch
        this.logger.debug(`Successfully deployed native interchain contract, txId: ${executeTxHash}`);

        executeTxHash = null;
        // No break here is intentional
      }
      case 'ITS_EXECUTE': {
        this.logger.debug(`Calling execute-deploy-interchain-token function...`);

        const verificationParams = await this.verifyOnchain.buildNativeInterchainTokenVerificationParams(
          extraData.deployTxHash as string,
        );

        const payload = HubMessage.clarityEncode(message);

        const transaction = await this.executeDeployInterchainToken(
          senderKey,
          payload,
          messageId,
          sourceChain,
          sourceAddress,
          extraData.contractId as string,
          verificationParams,
        );

        return {
          transaction,
          incrementRetry: false,
          extraData: {
            step: 'ITS_EXECUTE',
            contractId: extraData.contractId,
            timestamp: undefined,
            deployTxHash: extraData.deployTxHash,
          } as ItsExtraData,
        };
      }
    }
  }

  async executeReceiveInterchainToken(
    senderKey: string,
    message: ReceiveFromHub,
    messageId: string,
    sourceChain: string,
    sourceAddress: string,
    tokenInfo: TokenInfo,
    availableGasBalance: string,
  ): Promise<StacksTransaction> {
    const tokenAddress = await this.tokenManagerContract.getTokenAddress(tokenInfo);
    if (!tokenAddress) {
      throw new ItsError(`Could not get token address for token id ${message.payload.tokenId}`);
    }

    const itsImpl = await this.getItsImpl();
    const gatewayImpl = await this.gatewayContract.getGatewayImpl();

    const innerMessage = message.payload as InterchainTransfer;

    const destinationContract = optionalCVOf(
      isEmptyData(innerMessage.data) ? undefined : principalCV(innerMessage.destinationAddress),
    );
    const payload = HubMessage.clarityEncode(message);

    const postConditions = await this.getExecuteReceivePostConditions(tokenInfo, innerMessage.amount, tokenAddress);

    const transaction = await this.transactionsHelper.makeContractCall({
      contractAddress: this.proxyContractAddress,
      contractName: this.proxyContractName,
      functionName: 'execute-receive-interchain-token',
      functionArgs: [
        principalCV(gatewayImpl),
        principalCV(itsImpl),
        stringAsciiCV(sourceChain),
        stringAsciiCV(messageId),
        stringAsciiCV(sourceAddress),
        principalCV(tokenInfo.managerAddress),
        principalCV(tokenAddress),
        payload,
        destinationContract,
      ],
      senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
      postConditions,
    });

    await this.transactionsHelper.checkAvailableGasBalance(messageId, availableGasBalance, [{ transaction }]);

    return transaction;
  }

  async executeDeployInterchainToken(
    senderKey: string,
    payload: ClarityValue,
    messageId: string,
    sourceChain: string,
    sourceAddress: string,
    tokenAddress: string,
    verificationParams: TupleCV,
    simulate: boolean = false,
  ): Promise<StacksTransaction> {
    const postCondition = createSTXPostCondition(
      this.transactionsHelper.getWalletSignerAddress(),
      FungibleConditionCode.LessEqual,
      0,
    );

    const itsImpl = await this.getItsImpl();
    const gatewayImpl = await this.gatewayContract.getGatewayImpl();
    const gasImpl = await this.gasServiceContract.getGasImpl();

    return await this.transactionsHelper.makeContractCall(
      {
        contractAddress: this.proxyContractAddress,
        contractName: this.proxyContractName,
        functionName: 'execute-deploy-interchain-token',
        functionArgs: [
          principalCV(gatewayImpl),
          principalCV(gasImpl),
          principalCV(itsImpl),
          stringAsciiCV(sourceChain),
          stringAsciiCV(messageId),
          stringAsciiCV(sourceAddress),
          principalCV(tokenAddress),
          payload,
          verificationParams,
        ],
        senderKey,
        network: this.network,
        anchorMode: AnchorMode.Any,
        postConditions: [postCondition],
      },
      simulate,
    );
  }

  decodeInterchainTokenDeploymentStartedEvent(event: ScEvent): InterchainTokenDeploymentStartedEvent {
    return DecodingUtils.decodeEvent<InterchainTokenDeploymentStartedEvent>(
      event,
      interchainTokenDeploymentStartedEventDecoder,
    );
  }

  decodeInterchainTransferEvent(event: ScEvent): InterchainTransferEvent {
    return DecodingUtils.decodeEvent<InterchainTransferEvent>(event, interchainTransferEventDecoder);
  }

  async getTokenInfo(tokenId: string): Promise<TokenInfo | null> {
    try {
      const response = await callReadOnlyFunction({
        contractAddress: this.storageContractAddress,
        contractName: this.storageContractName,
        functionName: 'get-token-info',
        functionArgs: [bufferCV(BinaryUtils.hexToBuffer(tokenId))],
        network: this.network,
        senderAddress: this.storageContractAddress,
      });

      const parsedResponse = cvToJSON(response);

      // Token not yet registered with Stacks ITS contract
      if (parsedResponse.value === null) {
        return null;
      }

      return {
        managerAddress: parsedResponse.value.value['manager-address'].value,
        tokenType: parsedResponse.value.value['token-type'].value,
      };
    } catch (e) {
      this.logger.error(`Failed to call get-token-info for ${tokenId}`, e);
      await this.slackApi.sendError('ITS contract error', `Failed to call get-token-info for ${tokenId}`);

      throw e;
    }
  }

  private async getExecuteReceivePostConditions(
    tokenInfo: TokenInfo,
    amount: string,
    tokenContractId: string,
  ): Promise<PostCondition[] | undefined> {
    if (tokenInfo.tokenType === TokenType.NATIVE_INTERCHAIN_TOKEN) {
      return undefined;
    }

    const fungibleTokens = await this.tokenManagerContract.getTokenContractFungibleTokens(tokenContractId);
    if (!fungibleTokens) {
      throw new ItsError(`Could not get asset name for token ${tokenContractId}`);
    }

    const [tokenAddress, tokenContractName] = splitContractId(tokenContractId);

    const postConditions = [];

    for (const fungibleToken of fungibleTokens) {
      const postCondition = createFungiblePostCondition(
        tokenInfo.managerAddress,
        FungibleConditionCode.LessEqual,
        amount,
        createAssetInfo(tokenAddress, tokenContractName, fungibleToken.name),
      );

      postConditions.push(postCondition);
    }

    return postConditions;
  }

  private async checkDeployInterchainTokenGasBalance(
    senderKey: string,
    message: ReceiveFromHub,
    messageId: string,
    sourceChain: string,
    sourceAddress: string,
    availableGasBalance: string,
  ) {
    const gasCheckerPayload: GasCheckerPayload[] = [];
    const innerMessage = message.payload as DeployInterchainToken;

    const { transaction: deployTx } = await this.nativeInterchainTokenContract.deployContractTransaction(
      senderKey,
      innerMessage.name,
      true,
    );
    gasCheckerPayload.push({ transaction: deployTx, deployContract: true });

    const templateContractId = this.nativeInterchainTokenContract.getTemplateContractId();
    const templateDeployTx = await this.nativeInterchainTokenContract.getTemplateDeployVerificationParams();
    const [templateContractAddress, templateContractName] = splitContractId(templateContractId);
    const setupTx = await this.nativeInterchainTokenContract.setupTransaction(
      senderKey,
      templateContractAddress,
      templateContractName,
      innerMessage,
      true,
    );
    gasCheckerPayload.push({ transaction: setupTx });

    const payload = HubMessage.clarityEncode(message);

    const executeDeployInterchainTokenTx = await this.executeDeployInterchainToken(
      senderKey,
      payload,
      messageId,
      sourceChain,
      sourceAddress,
      templateContractId,
      templateDeployTx,
      true,
    );
    gasCheckerPayload.push({ transaction: executeDeployInterchainTokenTx });

    await this.transactionsHelper.checkAvailableGasBalance(messageId, availableGasBalance, gasCheckerPayload);
  }

  private async checkPendingTransactionSuccess(
    executeTxHash: string,
    extraData: ItsExtraData,
  ): Promise<MessageApprovedData | null> {
    const { isFinished, success } = await this.transactionsHelper.isTransactionSuccessfulWithTimeout(
      executeTxHash,
      extraData.timestamp as number,
    );

    // If not yet finished wait more
    if (!isFinished) {
      this.logger.debug(`Deploy native interchain contract transaction txId: ${executeTxHash} not yet finished`);

      return {
        transaction: null,
        incrementRetry: false,
        extraData,
      };
    }

    if (!success) {
      this.logger.error(`Could not deploy native interchain token, txId: ${executeTxHash}`);
      await this.slackApi.sendError(
        'ITS contract error',
        `Could not deploy native interchain token, txId: ${executeTxHash}`,
      );

      return {
        transaction: null,
        incrementRetry: true,
        extraData,
      };
    }

    return null;
  }
}
