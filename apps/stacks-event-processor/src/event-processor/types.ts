import { DecodingUtils } from '@stacks-monorepo/common/utils/decoding.utils';

export interface ContractLog {
  contract_id: string;
  topic: string;
  value: {
    hex: string;
    repr: string;
  };
}

export interface ScEvent {
  event_index: number;
  event_type: 'smart_contract_log';
  tx_id: string;
  contract_log: ContractLog;
}

export function getContractAddress(event: ScEvent): string {
  return event.contract_log.contract_id.split('.')[0];
}

export function getEventType(event: ScEvent): string {
  return DecodingUtils.decodeType(event.contract_log.value.hex);
}
