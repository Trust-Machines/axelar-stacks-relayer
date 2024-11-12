import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Client as AxelarGmpApiClient,
  BroadcastID,
  BroadcastRequest,
  Components,
} from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { ApiConfigService } from '../config';
import Event = Components.Schemas.Event;
import PublishEventsResult = Components.Schemas.PublishEventsResult;
import PublishEventErrorResult = Components.Schemas.PublishEventErrorResult;

@Injectable()
export class AxelarGmpApi {
  private readonly logger: Logger;

  constructor(
    @Inject(ProviderKeys.AXELAR_GMP_API_CLIENT) private readonly apiClient: AxelarGmpApiClient,
    private readonly apiConfigService: ApiConfigService,
  ) {
    this.logger = new Logger(AxelarGmpApi.name);
  }

  async postEvents(events: Event[], txHash: string) {
    this.logger.debug(`Sending events to Amplifier API for verification`);

    const res = await this.apiClient.post<PublishEventsResult>(`/chains/${CONSTANTS.SOURCE_CHAIN_NAME}/events`, {
      events,
    });

    if (res.data.results.length !== events.length) {
      throw new Error('Not all events were sent');
    }

    for (const result of res.data.results) {
      if (result.status === 'ACCEPTED') {
        continue;
      }

      const errorResult = result as PublishEventErrorResult;

      const event: Event = events[errorResult.index];

      if (!errorResult.retriable) {
        this.logger.error(
          `Failed sending event ${event.type} to GMP API for transaction ${txHash}. Can NOT be retried, error: ${errorResult.error}`,
          result,
        );

        continue;
      }

      this.logger.warn(
        `Failed sending event ${event.type} to GMP API for transaction ${txHash}. Will be retried, error: ${errorResult.error}`,
        result,
      );

      throw new Error(`Received retriable event error`);
    }
  }

  async getTasks(chain: string, lastUUID?: string | undefined, limit: number = 10) {
    return await this.apiClient.getTasks({
      chain,
      after: lastUUID,
      limit,
    });
  }

  async broadcastMsgExecuteContract(request: BroadcastRequest) {
    const response = await this.apiClient.broadcastMsgExecuteContract(
      {
        wasmContractAddress: this.apiConfigService.getMultisigProverContract(),
      },
      request,
    );

    return response.data.broadcastID;
  }

  async getMsgExecuteContractBroadcastStatus(id: BroadcastID): Promise<Components.Schemas.BroadcastStatus> {
    const response = await this.apiClient.getMsgExecuteContractBroadcastStatus({
      wasmContractAddress: this.apiConfigService.getMultisigProverContract(),
      broadcastID: id,
    });

    return response.data.status;
  }
}
