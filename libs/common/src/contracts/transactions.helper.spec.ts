import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { StacksNetwork } from '@stacks/network';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { ApiConfigService, TransactionsHelper } from '@stacks-monorepo/common';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { estimateContractDeploy, estimateContractFunctionCall } from '@stacks/transactions';
import { TooLowAvailableBalanceError } from '@stacks-monorepo/common/contracts/entities/too-low-available-balance.error';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

jest.mock('@stacks/transactions', () => {
  const actual = jest.requireActual('@stacks/transactions');
  return {
    ...actual,
    estimateContractDeploy: jest.fn(),
    estimateContractFunctionCall: jest.fn(),
  };
});

const mockWalletSigner = '9c9383646b956966d8856aa6d0770ccb0b8607a3c45d36dbc527cdc22be614d101';

describe('TransactionHelper', () => {
  let service: TransactionsHelper;

  let mockHiroApiHelper: DeepMocked<HiroApiHelper>;
  let mockRedisHelper: DeepMocked<RedisHelper>;
  let mockNetwork: DeepMocked<StacksNetwork>;
  let mockApiConfigService: DeepMocked<ApiConfigService>;
  let mockSlackApi: DeepMocked<SlackApi>;

  beforeEach(() => {
    mockHiroApiHelper = createMock();
    mockRedisHelper = createMock();
    mockNetwork = createMock();
    mockApiConfigService = createMock();
    mockSlackApi = createMock();

    mockNetwork.isMainnet.mockReturnValueOnce(false);
    mockApiConfigService.getAvailableGasCheckEnabled.mockReturnValueOnce(true);

    service = new TransactionsHelper(
      mockHiroApiHelper,
      mockRedisHelper,
      mockSlackApi,
      mockWalletSigner,
      mockNetwork,
      mockApiConfigService,
    );
  });

  describe('isTransactionSuccessfulWithTimeout', () => {
    it('should still be pending no timeout', async () => {
      const transaction = {
        tx_status: 'pending',
      } as unknown as Transaction;
      mockHiroApiHelper.getTransaction.mockResolvedValueOnce(transaction);

      jest.spyOn(Date, 'now').mockReturnValue(1000);

      const result = await service.isTransactionSuccessfulWithTimeout('txHash', 1000);

      expect(result).toEqual({
        isFinished: false,
        success: false,
      });

      expect(mockHiroApiHelper.getTransaction).toHaveBeenCalledTimes(1);
    });

    it('should still be pending but timed out', async () => {
      const transaction = {
        tx_status: 'pending',
      } as unknown as Transaction;
      mockHiroApiHelper.getTransaction.mockResolvedValueOnce(transaction);

      jest.spyOn(Date, 'now').mockReturnValue(601_001);

      const result = await service.isTransactionSuccessfulWithTimeout('txHash', 1000);

      expect(result).toEqual({
        isFinished: true,
        success: false,
      });

      expect(mockHiroApiHelper.getTransaction).toHaveBeenCalledTimes(1);
    });

    it('should be successful', async () => {
      const transaction = {
        tx_status: 'success',
      } as unknown as Transaction;
      mockHiroApiHelper.getTransaction.mockResolvedValueOnce(transaction);

      const result = await service.isTransactionSuccessfulWithTimeout('txHash', 1000);

      expect(result).toEqual({
        isFinished: true,
        success: true,
      });

      expect(mockHiroApiHelper.getTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkAvailableGasBalance', () => {
    it('should have enough balance', async () => {
      // These functions were mocked at the top of the file
      // @ts-ignore
      estimateContractDeploy.mockReturnValue(50n);
      // @ts-ignore
      estimateContractFunctionCall.mockReturnValue(75n);

      const result = await service.checkAvailableGasBalance('messageId', '125', [
        {
          transaction: createMock(),
          deployContract: true,
        },
        {
          transaction: createMock(),
          deployContract: false,
        },
      ]);

      expect(result).toEqual(true);

      expect(estimateContractDeploy).toHaveBeenCalledTimes(1);
      expect(estimateContractFunctionCall).toHaveBeenCalledTimes(1);
    });

    it('should not have enough balance', async () => {
      // These functions were mocked at the top of the file
      // @ts-ignore
      estimateContractDeploy.mockReturnValue(50n);
      // @ts-ignore
      estimateContractFunctionCall.mockReturnValue(75n);

      await expect(
        service.checkAvailableGasBalance('messageId', '124', [
          {
            transaction: createMock(),
            deployContract: true,
          },
          {
            transaction: createMock(),
            deployContract: false,
          },
        ]),
      ).rejects.toThrow(TooLowAvailableBalanceError);
    });
  });
});
