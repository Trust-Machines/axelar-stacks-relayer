import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';

export function mapRawEventsToSmartContractEvents(events: any[]): ScEvent[] {
  return events
    .filter((event: any): event is ScEvent => event.event_type === 'smart_contract_log' && 'contract_log' in event)
    .map((event: any) => ({
      event_index: event.event_index,
      event_type: event.event_type,
      tx_id: event.tx_id,
      contract_log: event.contract_log,
    }));
}
