import { cvToJSON, deserializeCV } from '@stacks/transactions';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import BigNumber from 'bignumber.js';
import { GasAddedEvent, GasPaidForContractCallEvent, RefundedEvent } from '../contracts/entities/gas-service-events';
import {
  ContractCallEvent,
  GatewayExternalData,
  MessageApprovedEvent,
  MessageExecutedEvent,
  TokenManagerParams,
  WeightedSignersEvent,
} from '../contracts/entities/gateway-events';
import {
  DeployInterchainToken,
  DeployTokenManager,
  InterchainTransfer,
} from '../contracts/ITS/messages/hub.message.types';

export class DecodingUtils {
  static deserialize(hex: string) {
    return cvToJSON(deserializeCV(hex));
  }

  static decodeEvent<T>(event: ScEvent, decoder: (json: any) => T): T {
    const json = DecodingUtils.deserialize(event.contract_log.value.hex);

    return decoder(json.value);
  }

  static decodeType(hex: string): string {
    const json = cvToJSON(deserializeCV(hex));
    return json.value['type'].value ?? '';
  }

  static getEventId(txHash: string, index: number) {
    // The id needs to have `0x` in front of the txHash (hex string)
    return `${txHash}-${index}`;
  }
}

export const gatewayTxDataDecoder = (json: any): GatewayExternalData => ({
  function: json.value['function'].value,
  data: json.value['data'].value,
  proof: json.value['proof'].value,
});

export const contractCallDecoder = (json: any): ContractCallEvent => ({
  sender: json['sender'].value,
  destinationChain: json['destination-chain'].value,
  destinationAddress: json['destination-contract-address'].value,
  payloadHash: json['payload-hash'].value,
  payload: Buffer.from(json['payload'].value.replace('0x', ''), 'hex'),
});

export const messageApprovedDecoder = (json: any): MessageApprovedEvent => ({
  commandId: json['command-id'].value,
  sourceChain: json['source-chain'].value,
  messageId: json['message-id'].value,
  sourceAddress: json['source-address'].value,
  contractAddress: json['contract-address'].value,
  payloadHash: json['payload-hash'].value,
});

export const messageExecutedDecoder = (json: any): MessageExecutedEvent => ({
  commandId: json['command-id'].value,
  sourceChain: json['source-chain'].value,
  messageId: json['message-id'].value,
});

export const weightedSignersDecoder = (json: any): WeightedSignersEvent => ({
  signers: json.signers.value['signers'].value.map((signer: any) => ({
    signer: signer.value['signer'].value,
    weight: new BigNumber(signer.value['weight'].value),
  })),
  threshold: new BigNumber(json.signers.value['threshold'].value),
  nonce: json.signers.value['nonce'].value,
  epoch: parseInt(json['epoch'].value),
  signersHash: Buffer.from(json['signers-hash'].value.replace('0x', ''), 'hex'),
});

export const gasPaidForContractCallDecoder = (json: any): GasPaidForContractCallEvent => ({
  sender: json['sender'].value,
  destinationChain: json['destination-chain'].value,
  destinationAddress: json['destination-address'].value,
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

export const tokenManagerParamsDecoder = (json: any): TokenManagerParams => {
  return {
    operator: json.value['operator']?.value,
    tokenAddress: json.value['token-address'].value,
  };
};

export const interchainTransferDecoder = (json: any): InterchainTransfer => ({
  messageType: parseInt(json.value['type'].value),
  tokenId: json.value['token-id'].value,
  sourceAddress: json.value['source-address'].value,
  destinationAddress: json.value['destination-address'].value,
  amount: new BigNumber(json.value['amount'].value).toFixed(),
  data: json.value['data'].value,
});

export const deployInterchainTokenDecoder = (json: any): DeployInterchainToken => ({
  messageType: parseInt(json.value['type'].value),
  tokenId: json.value['token-id'].value,
  name: json.value['name'].value,
  symbol: json.value['symbol'].value,
  decimals: parseInt(json.value['decimals'].value),
  minter: json.value['minter'].value,
});

export const deployTokenManagerDecoder = (json: any): DeployTokenManager => ({
  messageType: parseInt(json.value['type'].value),
  tokenId: json.value['token-id'].value,
  tokenManagerType: json.value['token-manager-type'].value,
  params: json.value['params'].value,
});
