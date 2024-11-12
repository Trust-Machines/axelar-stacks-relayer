import {
  bufferCV,
  ClarityValue,
  cvToHex,
  principalCV,
  serializeCV,
  stringAsciiCV,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import { AbiCoder } from 'ethers';
import { DeployInterchainToken, DeployTokenManager, HubMessageType, InterchainTransfer } from './hub.message.types';
import { BinaryUtils } from '@stacks-monorepo/common/utils';
import {
  DecodingUtils,
  deployInterchainTokenDecoder,
  deployTokenManagerDecoder,
  interchainTransferDecoder,
} from '@stacks-monorepo/common/utils/decoding.utils';

export class HubInnerMessage {
  static abiDecode(payload: string): InterchainTransfer | DeployInterchainToken | DeployTokenManager | null {
    const decoded = AbiCoder.defaultAbiCoder().decode(['uint256'], payload);
    const messageType = parseInt(decoded[0]);

    switch (messageType) {
      case HubMessageType.InterchainTransfer:
        return this.decodeInterchainTransfer(payload);
      case HubMessageType.DeployInterchainToken:
        return this.decodeDeployInterchainToken(payload);
      case HubMessageType.DeployTokenManager:
        return this.decodeDeployTokenManager(payload);
      default:
        throw new Error(`Unsupported messageType for abiDecode: ${messageType}`);
    }
  }

  static abiEncode(payload: string): string {
    const json = DecodingUtils.deserialize(payload);
    const type = parseInt(json.value['type'].value);

    switch (type) {
      case HubMessageType.InterchainTransfer:
        return this.abiEncodeInterchainTransfer(interchainTransferDecoder(json));
      case HubMessageType.DeployInterchainToken:
        return this.abiEncodeDeployInterchainToken(deployInterchainTokenDecoder(json));
      case HubMessageType.DeployTokenManager:
        return this.abiEncodeDeployTokenManager(deployTokenManagerDecoder(json));
      default:
        throw new Error(`Unsupported messageType for abiEncode: ${type}`);
    }
  }

  static clarityEncode(
    message: InterchainTransfer | DeployInterchainToken | DeployTokenManager,
    sourceChain: string,
  ): ClarityValue {
    switch (message.messageType) {
      case HubMessageType.InterchainTransfer:
        return this.clarityEncodeInterchainTransfer(message as InterchainTransfer, sourceChain);
      case HubMessageType.DeployInterchainToken:
        return this.clarityEncodeDeployInterchainToken(message as DeployInterchainToken, sourceChain);
      case HubMessageType.DeployTokenManager:
        return this.clarityEncodeDeployTokenManager(message as DeployTokenManager, sourceChain);
      default:
        throw new Error(`Unsupported messageType for clarityEncode: ${message.messageType}`);
    }
  }

  static decodeInterchainTransfer(payload: string): InterchainTransfer {
    const types = ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'];
    const decoded = AbiCoder.defaultAbiCoder().decode(types, payload);

    return {
      messageType: parseInt(decoded[0]),
      tokenId: decoded[1].toString(),
      sourceAddress: decoded[2].toString(),
      destinationAddress: decoded[3].toString(),
      amount: decoded[4].toString(),
      data: decoded?.[5] ? decoded[5].toString() : '',
    };
  }

  static decodeDeployInterchainToken(payload: string): DeployInterchainToken {
    const types = ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'];
    const decoded = AbiCoder.defaultAbiCoder().decode(types, payload);

    return {
      messageType: parseInt(decoded[0]),
      tokenId: decoded[1].toString(),
      name: decoded[2],
      symbol: decoded[3],
      decimals: parseInt(decoded[4]),
      minter: decoded[5].toString(),
    };
  }

  static decodeDeployTokenManager(payload: string): DeployTokenManager {
    const types = ['uint256', 'bytes32', 'uint256', 'bytes'];
    const decoded = AbiCoder.defaultAbiCoder().decode(types, payload);

    return {
      messageType: parseInt(decoded[0]),
      tokenId: decoded[1],
      tokenManagerType: parseInt(decoded[2]),
      params: decoded[3].toString(),
    };
  }

  static clarityEncodeInterchainTransfer(message: InterchainTransfer, sourceChain: string): ClarityValue {
    return bufferCV(
      serializeCV(
        tupleCV({
          type: uintCV(message.messageType),
          'token-id': bufferCV(BinaryUtils.hexToBuffer(message.tokenId)),
          'source-address': bufferCV(BinaryUtils.hexToBuffer(message.sourceAddress)),
          'destination-address': bufferCV(BinaryUtils.hexToBuffer(message.destinationAddress)),
          amount: uintCV(message.amount),
          data: bufferCV(BinaryUtils.hexToBuffer(message.data)),
          'source-chain': stringAsciiCV(sourceChain),
        }),
      ),
    );
  }

  static clarityEncodeDeployInterchainToken(message: DeployInterchainToken, sourceChain: string): ClarityValue {
    return bufferCV(
      serializeCV(
        tupleCV({
          type: uintCV(message.messageType),
          'token-id': bufferCV(BinaryUtils.hexToBuffer(message.tokenId)),
          name: stringAsciiCV(message.name),
          symbol: stringAsciiCV(message.symbol),
          decimals: uintCV(message.decimals),
          'minter-bytes': bufferCV(BinaryUtils.hexToBuffer(message.minter)),
          'source-chain': stringAsciiCV(sourceChain),
        }),
      ),
    );
  }

  static clarityEncodeDeployTokenManager(message: DeployTokenManager, sourceChain: string): ClarityValue {
    return bufferCV(
      serializeCV(
        tupleCV({
          type: uintCV(message.messageType),
          'token-id': bufferCV(BinaryUtils.hexToBuffer(message.tokenId)),
          'token-manager-type': uintCV(message.tokenManagerType),
          params: bufferCV(BinaryUtils.hexToBuffer(message.params)),
          'source-chain': stringAsciiCV(sourceChain),
        }),
      ),
    );
  }

  static abiEncodeInterchainTransfer(message: InterchainTransfer): string {
    const types = ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'];
    return AbiCoder.defaultAbiCoder().encode(types, [
      message.messageType,
      BinaryUtils.hexToBuffer(message.tokenId),
      BinaryUtils.hexToBuffer(cvToHex(principalCV(message.sourceAddress))),
      BinaryUtils.hexToBuffer(message.destinationAddress),
      BigInt(message.amount),
      BinaryUtils.hexToBuffer(message.data),
    ]);
  }

  static abiEncodeDeployInterchainToken(message: DeployInterchainToken): string {
    const types = ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'];
    return AbiCoder.defaultAbiCoder().encode(types, [
      message.messageType,
      BinaryUtils.hexToBuffer(message.tokenId),
      message.name,
      message.symbol,
      message.decimals,
      BinaryUtils.hexToBuffer(message.minter),
    ]);
  }

  static abiEncodeDeployTokenManager(message: DeployTokenManager): string {
    const types = ['uint256', 'bytes32', 'uint256', 'bytes'];

    return AbiCoder.defaultAbiCoder().encode(types, [
      message.messageType,
      BinaryUtils.hexToBuffer(message.tokenId),
      message.tokenManagerType,
      BinaryUtils.hexToBuffer(message.params),
    ]);
  }
}
