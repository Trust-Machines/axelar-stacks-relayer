import { BinaryUtils } from '@stacks-monorepo/common/utils';
import { DecodingUtils } from '@stacks-monorepo/common/utils/decoding.utils';
import { ClarityValue } from '@stacks/transactions';
import { AbiCoder } from 'ethers';
import { HubInnerMessage } from './hub.inner.message';
import { HubMessageType, ReceiveFromHub } from './hub.message.types';

export class HubMessage {
  static abiDecode(payloadHex: string): ReceiveFromHub | null {
    try {
      const types = ['uint256', 'string', 'bytes'];
      const decoded = AbiCoder.defaultAbiCoder().decode(types, BinaryUtils.addHexPrefix(payloadHex));

      const messageType = parseInt(decoded[0]);
      const sourceChain = decoded[1];
      const innerMessage = HubInnerMessage.abiDecode(decoded[2]);
      if (!innerMessage) {
        return null;
      }

      if (messageType === HubMessageType.ReceiveFromHub) {
        return {
          sourceChain,
          messageType,
          payload: innerMessage,
        } as ReceiveFromHub;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  static abiEncode(payloadHex: string): string | null {
    try {
      const json = DecodingUtils.deserialize(payloadHex);

      const type = parseInt(json.value['type'].value);

      if (type === HubMessageType.SendToHub) {
        const innerPayload = json.value['payload'].value;
        const innerPayloadAbiEncoded = HubInnerMessage.abiEncode(innerPayload);

        const destinationChain = json.value['destination-chain'].value;

        return AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'string', 'bytes'],
          [type, destinationChain, innerPayloadAbiEncoded],
        );
      }

      return null;
    } catch {
      return null;
    }
  }

  static clarityEncode(message: ReceiveFromHub): ClarityValue {
    return HubInnerMessage.clarityEncode(message.payload, message.sourceChain);
  }

  static clarityEncodeFromPayload(payloadHex: string): ClarityValue {
    const abiDecoded = HubMessage.abiDecode(payloadHex);
    if (!abiDecoded) {
      throw new Error('Invalid RECEIVE_FROM_HUB payload');
    }
    return this.clarityEncode(abiDecoded);
  }
}
