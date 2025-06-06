import { Injectable, Logger } from '@nestjs/common';
import { StacksNetwork } from '@stacks/network';
import { callReadOnlyFunction, Cl, SingleSigSpendingCondition, StringUtf8CV, TupleCV } from '@stacks/transactions';
import { intToHex } from '@stacks/common';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { getBlockHeader, proofPathToCV } from '@stacks-monorepo/common/helpers/block-hash';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

@Injectable()
export class VerifyOnchainContract {
  private readonly logger = new Logger(VerifyOnchainContract.name);

  constructor(
    private readonly verifyOnchainContract: string,
    private readonly network: StacksNetwork,
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly slackApi: SlackApi,
  ) {}

  async buildNativeInterchainTokenVerificationParams(txHash: string): Promise<TupleCV> {
    const deployTransaction = await this.hiroApiHelper.getTransaction(txHash);
    const rawTx = await this.hiroApiHelper.getTransactionRaw(deployTransaction.tx_id);

    const txIndex = deployTransaction.tx_index;

    const block = await this.hiroApiHelper.getBlock(deployTransaction.block_height);

    const { proof, blockHeader } = getBlockHeader(block, txIndex);

    return Cl.tuple({
      nonce: Cl.bufferFromHex(intToHex(deployTransaction.nonce, 8)),
      'fee-rate': Cl.bufferFromHex(intToHex(deployTransaction.fee_rate, 8)),
      signature: Cl.bufferFromHex((rawTx.auth.spendingCondition as SingleSigSpendingCondition).signature.data),
      proof: proofPathToCV(txIndex, proof, proof.length),
      'tx-block-height': Cl.uint(deployTransaction.block_height),
      'block-header-without-signer-signatures': Cl.buffer(blockHeader),
    });
  }

  async getNitSource() {
    try {
      const contractSplit = this.verifyOnchainContract.split('.');
      const clarityValue = await callReadOnlyFunction({
        contractAddress: contractSplit[0],
        contractName: contractSplit[1],
        functionName: 'get-nit-source',
        functionArgs: [],
        network: this.network,
        senderAddress: contractSplit[0],
      });

      const response = clarityValue as StringUtf8CV;

      return response.data;
    } catch (e) {
      this.logger.error('Failed to call get-nit-source', e);
      await this.slackApi.sendError('Verify OnChain contract error', 'Failed to call get-nit-source');

      throw e;
    }
  }
}
