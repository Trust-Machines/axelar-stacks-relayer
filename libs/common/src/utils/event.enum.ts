export enum Events {
  CONTRACT_CALL_EVENT = 'contract-call',
  MESSAGE_APPROVED_EVENT = 'message-approved',
  SIGNERS_ROTATED_EVENT = 'signers-rotated',
  MESSAGE_EXECUTED_EVENT = 'message-executed',

  GAS_PAID_FOR_CONTRACT_CALL_EVENT = 'gas_paid_for_contract_call_event',
  NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT = 'native_gas_paid_for_contract_call_event',
  GAS_ADDED_EVENT = 'gas_added_event',
  NATIVE_GAS_ADDED_EVENT = 'native_gas_added_event',
  REFUNDED_EVENT = 'refunded_event',
}
