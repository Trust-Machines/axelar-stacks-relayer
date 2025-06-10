import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { StacksService } from './services/stacks.service';
import { AxelarService } from './services/axelar.service';

interface StacksExecuteOptions {
  step?: 'CONTRACT_DEPLOY' | 'CONTRACT_SETUP' | 'ITS_EXECUTE';
  contractId?: string;
  deployTxHash?: string;
}

@Injectable()
@Command({ name: 'stacks-execute', description: 'Execute an ITS Hub payload on stacks' })
export class StacksExecute extends CommandRunner {
  private readonly logger: Logger;

  constructor(
    private readonly stackService: StacksService,
    private readonly axelarService: AxelarService,
  ) {
    super();

    this.logger = new Logger(StacksExecute.name);
  }

  async run(passedParam: string[], options?: StacksExecuteOptions): Promise<void> {
    if (!passedParam.length || !passedParam[0]) {
      this.logger.error('TxHash is required as first parameter');
      return;
    }

    const txHash = passedParam[0];

    const axelarCallEvent = await this.axelarService.getAxelarCallEvent(txHash);

    if (!axelarCallEvent) {
      return;
    }

    await this.stackService.executeOnStacksIts(
      axelarCallEvent,
      options?.step
        ? {
            step: options.step,
            deployTxHash: options.deployTxHash,
            contractId: options.contractId,
          }
        : undefined,
    );
  }

  @Option({
    flags: '-s, --step <step>',
    description: 'Execution step: CONTRACT_DEPLOY, CONTRACT_SETUP, or ITS_EXECUTE',
  })
  parseStep(val: string): 'CONTRACT_DEPLOY' | 'CONTRACT_SETUP' | 'ITS_EXECUTE' {
    const validSteps = ['CONTRACT_DEPLOY', 'CONTRACT_SETUP', 'ITS_EXECUTE'];
    if (!validSteps.includes(val)) {
      throw new Error(`Invalid step: ${val}. Must be one of: ${validSteps.join(', ')}`);
    }
    return val as 'CONTRACT_DEPLOY' | 'CONTRACT_SETUP' | 'ITS_EXECUTE';
  }

  @Option({
    flags: '-c, --contract-id <contractId>',
    description: 'Contract ID (required for CONTRACT_SETUP and ITS_EXECUTE steps)',
  })
  parseContractId(val: string): string {
    return val;
  }

  @Option({
    flags: '-d, --deploy-tx-hash <deployTxHash>',
    description: 'Deploy transaction hash',
  })
  parseDeployTxHash(val: string): string {
    return val;
  }
}
