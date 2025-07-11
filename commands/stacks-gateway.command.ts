import { Command, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { StacksService } from './services/stacks.service';

@Injectable()
@Command({ name: 'stacks-gateway', description: 'Call the Stacks gateway' })
export class StacksGatewayCommand extends CommandRunner {
  private readonly logger: Logger;

  constructor(
    private readonly stackService: StacksService,
  ) {
    super();

    this.logger = new Logger(StacksGatewayCommand.name);
  }

  async run(passedParam: string[]): Promise<void> {
    if (!passedParam.length || !passedParam[0]) {
      this.logger.error('executeData is required as first parameter');
      return;
    }

    const executeData = passedParam[0];

    this.logger.warn(`Successfully constructed proof in Stacks Multisig Prover`);

    await this.stackService.executeOnGateway(executeData);
  }
}
