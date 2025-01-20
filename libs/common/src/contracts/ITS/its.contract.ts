import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { splitContractId } from '@stacks-monorepo/common/utils/split-contract-id';
import { StacksNetwork } from '@stacks/network';
import {
  AnchorMode,
  bufferCV,
  callReadOnlyFunction,
  ClarityValue,
  createSTXPostCondition,
  cvToJSON,
  cvToString,
  FungibleConditionCode,
  optionalCVOf,
  principalCV,
  StacksTransaction,
  stringAsciiCV,
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
import { TokenType } from './types/token-type';
import { TokenInfo } from './types/token.info';
import { delay } from '@stacks-monorepo/common/utils/await-success';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
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

const SETUP_MAX_RETRY = 3;
const SETUP_DELAY = 300;

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
  ): Promise<StacksTransaction | null> {
    if (
      sourceChain !== CONSTANTS.AXELAR_CHAIN ||
      sourceAddress !== this.axelarContractIts
    ) {
      this.logger.warn(
        `Received message for Stacks ITS from non ITS Hub contract. Message ID: ${messageId}, source chain: ${sourceChain}, source address: ${sourceAddress}, destination address: ${destinationAddress}, payload: ${payloadHex}`,
      );

      return null;
    }

    this.logger.debug(
      `Executing message with ID: ${messageId}, source chain: ${sourceChain}, source address: ${sourceAddress}, destination address: ${destinationAddress}, payload: ${payloadHex}`,
    );

    const message = HubMessage.abiDecode(payloadHex);
    if (!message) {
      return null;
    }

    const innerMessage = message?.payload;

    switch (innerMessage?.messageType) {
      case HubMessageType.InterchainTransfer:
        return await this.handleInterchainTransfer(senderKey, message, messageId, sourceChain, availableGasBalance);
      case HubMessageType.DeployInterchainToken:
        return await this.handleDeployNativeInterchainToken(
          senderKey,
          message,
          messageId,
          sourceChain,
          sourceAddress,
          availableGasBalance,
        );
      default:
        this.logger.error(`Unknown message type: ${message?.messageType}`);
        return null;
    }
  }

  async handleInterchainTransfer(
    senderKey: string,
    message: ReceiveFromHub,
    messageId: string,
    sourceChain: string,
    availableGasBalance: string,
  ) {
    this.logger.debug(`Handling interchain transfer for message ID: ${messageId}, message: ${JSON.stringify(message)}`);
    const tokenInfo = await this.getTokenInfo(message.payload.tokenId);
    if (!tokenInfo) {
      throw new Error('Could not get token info');
    }

    return await this.executeReceiveInterchainToken(
      senderKey,
      message,
      messageId,
      sourceChain,
      tokenInfo,
      availableGasBalance,
    );
  }

  async getTokenInfo(tokenId: string): Promise<TokenInfo | null> {
    try {
      const response = await callReadOnlyFunction({
        contractAddress: this.storageContractAddress,
        contractName: this.storageContractName,
        functionName: 'get-token-info',
        functionArgs: [bufferCV(Buffer.from(tokenId, 'hex'))],
        network: this.network,
        senderAddress: this.storageContractAddress,
      });

      const parsedResponse = cvToJSON(response);

      const tokenInfo: TokenInfo = {
        managerAddress: parsedResponse.value['manager-address'].value,
        tokenType: parsedResponse.value['token-type'].value,
      };

      return tokenInfo;
    } catch (e) {
      this.logger.error('Failed to call get-token-info');
      this.logger.error(e);
      return null;
    }
  }

  async executeReceiveInterchainToken(
    senderKey: string,
    message: ReceiveFromHub,
    messageId: string,
    sourceChain: string,
    tokenInfo: TokenInfo,
    availableGasBalance: string,
  ): Promise<StacksTransaction> {
    const tokenAddress = await this.getTokenAddress(tokenInfo);
    if (!tokenAddress) {
      throw new Error('Could not get token address');
    }

    const [gatewayImpl, itsImpl] = await this.getImplContracts();

    const innerMessage = message.payload as InterchainTransfer;

    const destinationContract = optionalCVOf(
      isEmptyData(innerMessage.data) ? undefined : principalCV(innerMessage.data),
    );
    const payload = HubMessage.clarityEncode(message);

    const transaction = await this.transactionsHelper.makeContractCall({
      contractAddress: this.proxyContractAddress,
      contractName: this.proxyContractName,
      functionName: 'execute-receive-interchain-token',
      functionArgs: [
        principalCV(gatewayImpl),
        principalCV(itsImpl),
        stringAsciiCV(sourceChain),
        stringAsciiCV(messageId),
        stringAsciiCV(innerMessage.sourceAddress),
        principalCV(tokenInfo.managerAddress),
        principalCV(tokenAddress),
        payload,
        destinationContract,
      ],
      senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });

    await this.transactionsHelper.checkAvailableGasBalance(messageId, availableGasBalance, [{ transaction }]);

    return transaction;
  }

  async getTokenAddress(tokenInfo: TokenInfo) {
    if (tokenInfo.tokenType === TokenType.NATIVE_INTERCHAIN_TOKEN) {
      return tokenInfo.managerAddress;
    }

    return await this.tokenManagerContract.getTokenAddress(tokenInfo.managerAddress);
  }

  async handleDeployNativeInterchainToken(
    senderKey: string,
    message: ReceiveFromHub,
    messageId: string,
    sourceChain: string,
    sourceAddress: string,
    availableGasBalance: string,
  ): Promise<StacksTransaction> {
    this.logger.debug(
      `Handling deploy native interchain token for message ID: ${messageId}, message: ${JSON.stringify(message)}`,
    );

    const gasCheckerPayload = await this.buildDeployInterchainTokenGasCheckerPayload(
      senderKey,
      message,
      messageId,
      sourceChain,
      sourceAddress,
    );
    await this.transactionsHelper.checkAvailableGasBalance(messageId, availableGasBalance, gasCheckerPayload);

    this.logger.debug(`Deploying native interchain token contract...`);

    const innerMessage = message.payload as DeployInterchainToken;
    const { success: deploySuccess, transaction: deployTransaction } = await this.deployNativeInterchainTokenContract(
      senderKey,
      innerMessage.name,
    );

    this.logger.debug(`Deploy native interchain contract success: ${deploySuccess}, txId: ${deployTransaction?.tx_id}`);

    if (!deploySuccess || !deployTransaction || deployTransaction.tx_type !== 'smart_contract') {
      throw new Error(`Could not deploy native interchain token, hash = ${deployTransaction?.tx_id}`);
    }

    this.logger.debug(`Calling setup function on the native interchain token contract...`);

    const [smartContractAddress, smartContractName] = splitContractId(deployTransaction.smart_contract.contract_id);
    const { success: setupSuccess, transaction: setupTransaction } = await this.setupNativeInterchainTokenContract(
      senderKey,
      smartContractAddress,
      smartContractName,
      message,
    );

    this.logger.debug(`Setup native interchain contract success: ${setupSuccess}, txId: ${setupTransaction?.tx_id}`);

    if (!setupSuccess || !setupTransaction) {
      throw new Error(`Could not setup native interchain token, hash = ${setupTransaction?.tx_id}`);
    }

    const payload = HubMessage.clarityEncode(message);

    this.logger.debug(`Calling execute-deploy-interchain-token function...`);

    return await this.executeDeployInterchainToken(
      senderKey,
      payload,
      messageId,
      sourceChain,
      sourceAddress,
      deployTransaction.smart_contract.contract_id,
    );
  }

  async deployNativeInterchainTokenContract(senderKey: string, name: string) {
    const deployTx = await this.nativeInterchainTokenContract.deployContract(senderKey, name);
    const deployHash = await this.transactionsHelper.sendTransaction(deployTx);
    return await this.transactionsHelper.awaitSuccess(deployHash);
  }

  async setupNativeInterchainTokenContract(
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
      const setupTx = await this.nativeInterchainTokenContract.setup(
        senderKey,
        smartContractAddress,
        smartContractName,
        innerMessage,
      );
      const setupHash = await this.transactionsHelper.sendTransaction(setupTx);
      return await this.transactionsHelper.awaitSuccess(setupHash);
    } catch (e) {
      this.logger.error(`Could not setup ${smartContractAddress}.${smartContractName}. Retrying in ${SETUP_DELAY} ms`);
      this.logger.error(e);

      await delay(SETUP_DELAY);

      return await this.setupNativeInterchainTokenContract(
        senderKey,
        smartContractAddress,
        smartContractName,
        message,
        retry + 1,
      );
    }
  }

  async executeDeployInterchainToken(
    senderKey: string,
    payload: ClarityValue,
    messageId: string,
    sourceChain: string,
    sourceAddress: string,
    tokenAddress: string,
  ): Promise<StacksTransaction> {
    const postCondition = createSTXPostCondition(
      this.transactionsHelper.getWalletSignerAddress(),
      FungibleConditionCode.LessEqual,
      0,
    );

    const [gatewayImpl, itsImpl, gasImpl] = await this.getImplContracts();

    // TODO: Update after contract changes
    return await this.transactionsHelper.makeContractCall({
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
      ],
      senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
      postConditions: [postCondition],
    });
  }

  decodeInterchainTokenDeploymentStartedEvent(event: ScEvent): InterchainTokenDeploymentStartedEvent {
    return DecodingUtils.decodeEvent<InterchainTokenDeploymentStartedEvent>(event, interchainTokenDeploymentStartedEventDecoder);
  }

  decodeInterchainTransferEvent(event: ScEvent): InterchainTransferEvent {
    return DecodingUtils.decodeEvent<InterchainTransferEvent>(event, interchainTransferEventDecoder);
  }

  private async getImplContracts(): Promise<[string, string, string]> {
    const gatewayImpl = await this.gatewayContract.getGatewayImpl();
    const itsImpl = await this.getItsImpl();
    const gasImpl = await this.gasServiceContract.getGasImpl();

    return [gatewayImpl, itsImpl, gasImpl];
  }

  private async buildDeployInterchainTokenGasCheckerPayload(
    senderKey: string,
    message: ReceiveFromHub,
    messageId: string,
    sourceChain: string,
    sourceAddress: string,
  ): Promise<GasCheckerPayload[]> {
    const gasCheckerPayload: GasCheckerPayload[] = [];
    const innerMessage = message.payload as DeployInterchainToken;
    const deployTx = await this.nativeInterchainTokenContract.deployContract(senderKey, innerMessage.name);
    gasCheckerPayload.push({ transaction: deployTx, deployContract: true });

    const templateContractId = this.nativeInterchainTokenContract.getTemplaceContractId();
    const [templateContractAddress, templateContractName] = splitContractId(templateContractId);
    const setupTx = await this.nativeInterchainTokenContract.setup(
      senderKey,
      templateContractAddress,
      templateContractName,
      innerMessage,
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
    );
    gasCheckerPayload.push({ transaction: executeDeployInterchainTokenTx });

    return gasCheckerPayload;
  }
}
