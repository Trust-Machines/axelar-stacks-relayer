import {
  DecodingUtils,
  deployInterchainTokenDecoder,
  interchainTransferDecoder,
} from '@stacks-monorepo/common/utils/decoding.utils';
import { HubMessageType, ReceiveFromHub } from './hub.message.types';

export class HubMessage {
  static clarityDecode(payloadHex: string): ReceiveFromHub | null {
    try {
      const json = DecodingUtils.deserialize(payloadHex);

      const type = parseInt(json.value['type'].value);

      const sourceChain = json.value['source-chain'].value;

      if (type === HubMessageType.InterchainTransfer) {
        const payload = interchainTransferDecoder(json);

        return {
          sourceChain,
          payload,
        };
      } else if (type === HubMessageType.DeployInterchainToken) {
        const payload = deployInterchainTokenDecoder(json);

        return {
          sourceChain,
          payload,
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}
