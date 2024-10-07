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
  event_type: string;
  tx_id: string;
  contract_log: ContractLog;
}
