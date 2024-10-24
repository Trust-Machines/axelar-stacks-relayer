import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import BigNumber from 'bignumber.js';
import {
  ContractCallEvent,
  MessageApprovedEvent,
  MessageExecutedEvent,
  WeightedSignersEvent,
} from '../contracts/entities/gateway-events';
import { cvToJSON, deserializeCV } from '@stacks/transactions';
import { GasPaidForContractCallEvent, GasAddedEvent, RefundedEvent } from '../contracts/entities/gas-service-events';

export class DecodingUtils {
  static decodeHexToAscii = (hex: string): string => {
    return Buffer.from(hex.replace('0x', ''), 'hex').toString('ascii');
  };

  static decodeEvent<T>(event: ScEvent, decoder: (json: any) => T): T {
    const json = cvToJSON(deserializeCV(event.contract_log.value.hex));

    return decoder(json.value);
  }

  static decodeType(hex: string): string {
    const json = cvToJSON(deserializeCV(hex));
    return json.value['type'].value ?? '';
  }

  static getEventId(txHash: string, index: number) {
    // The id needs to have `0x` in front of the txHash (hex string)
    return `0x${txHash}-${index}`;
  }
}

export const contractCallDecoder = (json: any): ContractCallEvent => ({
  sender: json['sender'].value,
  destinationChain: DecodingUtils.decodeHexToAscii(json['destination-chain'].value),
  destinationAddress: DecodingUtils.decodeHexToAscii(json['destination-contract-address'].value),
  payloadHash: json['payload-hash'].value,
  payload: Buffer.from(json['payload'].value.replace('0x', ''), 'hex'),
});

export const messageApprovedDecoder = (json: any): MessageApprovedEvent => ({
  commandId: json['command-id'].value,
  sourceChain: DecodingUtils.decodeHexToAscii(json['source-chain'].value),
  messageId: DecodingUtils.decodeHexToAscii(json['message-id'].value),
  sourceAddress: DecodingUtils.decodeHexToAscii(json['source-address'].value),
  contractAddress: json['contract-address'].value,
  payloadHash: json['payload-hash'].value,
});

export const messageExecutedDecoder = (json: any): MessageExecutedEvent => ({
  commandId: json['command-id'].value,
  sourceChain: DecodingUtils.decodeHexToAscii(json['source-chain'].value),
  messageId: DecodingUtils.decodeHexToAscii(json['message-id'].value),
});

export const weightedSignersDecoder = (json: any): WeightedSignersEvent => ({
  signers: json.signers.value['signers'].value.map((signer: any) => ({
    signer: signer.value['signer'].value,
    weight: new BigNumber(signer.value['weight'].value),
  })),
  threshold: new BigNumber(json.signers.value['threshold'].value),
  nonce: json.signers.value['nonce'].value,
});

export const gasPaidForContractCallDecoder = (json: any): GasPaidForContractCallEvent => ({
  sender: json['sender'].value,
  destinationChain: DecodingUtils.decodeHexToAscii(json['destination-chain'].value),
  destinationAddress: DecodingUtils.decodeHexToAscii(json['destination-contract-address'].value),
  payloadHash: json['payload-hash'].value,
  amount: new BigNumber(json['amount'].value),
  refundAddress: json['refund-address'].value,
});

export const gasAddedDecoder = (json: any): GasAddedEvent => ({
  txHash: json['tx-hash'].value,
  logIndex: parseInt(json['log-index'].value),
  amount: new BigNumber(json['amount'].value),
  refundAddress: json['refund-address'].value,
});

export const refundedDecoder = (json: any): RefundedEvent => ({
  txHash: json['tx-hash'].value,
  logIndex: parseInt(json['log-index'].value),
  receiver: json['receiver'].value,
  amount: new BigNumber(json['amount'].value),
});
