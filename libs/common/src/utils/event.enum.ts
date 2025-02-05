export enum Events {
  CONTRACT_CALL_EVENT = 'contract-call',
  MESSAGE_APPROVED_EVENT = 'message-approved',
  SIGNERS_ROTATED_EVENT = 'signers-rotated',
  MESSAGE_EXECUTED_EVENT = 'message-executed',

  NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT = 'native-gas-paid-for-contract-call',
  NATIVE_GAS_ADDED_EVENT = 'native-gas-added',
  REFUNDED_EVENT = 'refunded',

  INTERCHAIN_TOKEN_DEPLOYMENT_STARTED = 'interchain-token-deployment-started',
  INTERCHAIN_TRANSFER = 'interchain-transfer',
}
