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
import { DeployInterchainToken, HubMessageType, InterchainTransfer } from './hub.message.types';
import { BinaryUtils } from '@stacks-monorepo/common/utils';
import {
  DecodingUtils,
  deployInterchainTokenDecoder,
  interchainTransferDecoder,
} from '@stacks-monorepo/common/utils/decoding.utils';
import { ItsError } from '@stacks-monorepo/common/contracts/entities/its.error';

export class HubInnerMessage {
  static abiDecode(payload: string): InterchainTransfer | DeployInterchainToken | null {
    const decoded = AbiCoder.defaultAbiCoder().decode(['uint256'], payload);
    const messageType = parseInt(decoded[0]);

    switch (messageType) {
      case HubMessageType.InterchainTransfer:
        return this.decodeInterchainTransfer(payload);
      case HubMessageType.DeployInterchainToken:
        return this.decodeDeployInterchainToken(payload);
      default:
        throw new ItsError(`Unsupported messageType for abiDecode: ${messageType}`);
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
      default:
        throw new ItsError(`Unsupported messageType for abiEncode: ${type}`);
    }
  }

  static clarityEncode(
    message: InterchainTransfer | DeployInterchainToken,
    sourceChain: string,
  ): ClarityValue {
    switch (message.messageType) {
      case HubMessageType.InterchainTransfer:
        return this.clarityEncodeInterchainTransfer(message as InterchainTransfer, sourceChain);
      case HubMessageType.DeployInterchainToken:
        return this.clarityEncodeDeployInterchainToken(message as DeployInterchainToken, sourceChain);
      default:
        throw new ItsError(`Unsupported messageType for clarityEncode: ${message.messageType}`);
    }
  }

  static decodeInterchainTransfer(payload: string): InterchainTransfer {
    const types = ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'];
    const decoded = AbiCoder.defaultAbiCoder().decode(types, payload);

    return {
      messageType: parseInt(decoded[0]),
      tokenId: decoded[1].toString(),
      senderAddress: decoded[2].toString(),
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

  static clarityEncodeInterchainTransfer(message: InterchainTransfer, sourceChain: string): ClarityValue {
    return bufferCV(
      serializeCV(
        tupleCV({
          type: uintCV(message.messageType),
          'token-id': bufferCV(BinaryUtils.hexToBuffer(message.tokenId)),
          'source-address': bufferCV(BinaryUtils.hexToBuffer(message.senderAddress)),
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

  static abiEncodeInterchainTransfer(message: InterchainTransfer): string {
    const types = ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'];
    return AbiCoder.defaultAbiCoder().encode(types, [
      message.messageType,
      BinaryUtils.hexToBuffer(message.tokenId),
      BinaryUtils.hexToBuffer(cvToHex(principalCV(message.senderAddress))),
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
}
