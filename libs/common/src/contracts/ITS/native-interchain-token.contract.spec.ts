import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { StacksNetwork } from '@stacks/network';
import { TransactionsHelper } from '@stacks-monorepo/common';
import { NativeInterchainTokenContract } from '@stacks-monorepo/common/contracts/ITS/native-interchain-token.contract';
import { HubMessage } from '@stacks-monorepo/common/contracts/ITS/messages/hub.message';
import {
  DeployInterchainToken,
  HubMessageType,
} from '@stacks-monorepo/common/contracts/ITS/messages/hub.message.types';
import { VerifyOnchainContract } from '@stacks-monorepo/common/contracts/ITS/verify-onchain.contract';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';

jest.mock('@stacks/transactions', () => {
  const actual = jest.requireActual('@stacks/transactions');
  return {
    ...actual,
    callReadOnlyFunction: jest.fn(),
    cvToString: jest.fn(),
  };
});

const mockContract = 'mockContractAddress.mockContractName';

describe('NativeInterchainTokenContract', () => {
  let service: NativeInterchainTokenContract;

  let mockVerifyOnchainContract: DeepMocked<VerifyOnchainContract>;
  let mockNetwork: DeepMocked<StacksNetwork>;
  let mockTransactionsHelper: DeepMocked<TransactionsHelper>;
  let mockHiroApiHelper: DeepMocked<HiroApiHelper>;

  beforeEach(() => {
    mockVerifyOnchainContract = createMock<VerifyOnchainContract>();
    mockNetwork = createMock<StacksNetwork>();
    mockTransactionsHelper = createMock<TransactionsHelper>();
    mockHiroApiHelper = createMock<HiroApiHelper>();

    service = new NativeInterchainTokenContract(
      mockContract,
      mockVerifyOnchainContract,
      mockNetwork,
      mockTransactionsHelper,
      mockHiroApiHelper,
    );

    jest.spyOn(HubMessage, 'abiDecode').mockImplementation(jest.fn());
  });

  describe('doSetupContract', () => {
    const senderKey = 'mockSenderKey';
    const smartContractAddress = 'mockAddress';
    const smartContractName = 'mockName';
    const receiveFromHub = {
      messageType: HubMessageType.ReceiveFromHub,
      payload: { messageType: HubMessageType.DeployInterchainToken } as DeployInterchainToken,
      sourceChain: 'sourceChain',
    };

    it('should successfully setup native interchain token contract', async () => {
      const setupTx = { tx_id: 'mockSetupTxId' } as any;

      jest.spyOn(service, 'setupTransaction').mockReturnValue(setupTx);
      mockTransactionsHelper.sendTransaction.mockResolvedValue('mockSetupHash');
      mockTransactionsHelper.awaitSuccess.mockResolvedValue({
        success: true,
        transaction: setupTx,
      });

      const result = await service.doSetupContract(senderKey, smartContractAddress, smartContractName, receiveFromHub);

      expect(service.setupTransaction).toHaveBeenCalledWith(
        senderKey,
        smartContractAddress,
        smartContractName,
        receiveFromHub.payload,
      );
      expect(mockTransactionsHelper.sendTransaction).toHaveBeenCalledWith(setupTx);
      expect(mockTransactionsHelper.awaitSuccess).toHaveBeenCalledWith('mockSetupHash');
      expect(result).toEqual({ success: true, transaction: setupTx });
    });

    it('should retry on failure and eventually succeed', async () => {
      const setupTx = { tx_id: 'mockSetupTxId' } as any;

      jest.spyOn(service, 'setupTransaction').mockReturnValue(setupTx);
      mockTransactionsHelper.sendTransaction.mockResolvedValue('mockSetupHash');
      mockTransactionsHelper.awaitSuccess
        .mockRejectedValueOnce(new Error('Internal server error'))
        .mockResolvedValueOnce({ success: true, transaction: setupTx });

      const result = await service.doSetupContract(senderKey, smartContractAddress, smartContractName, receiveFromHub);

      expect(mockTransactionsHelper.awaitSuccess).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true, transaction: setupTx });
    });

    it('should throw an error if max retries are reached', async () => {
      const setupTx = { tx_id: 'mockSetupTxId' } as any;

      jest.spyOn(service, 'setupTransaction').mockReturnValue(setupTx);
      mockTransactionsHelper.sendTransaction.mockResolvedValue('mockSetupHash');
      mockTransactionsHelper.awaitSuccess.mockRejectedValue(new Error('Internal server error'));

      await expect(
        service.doSetupContract(senderKey, smartContractAddress, smartContractName, receiveFromHub, 0),
      ).rejects.toThrow('Could not setup mockAddress.mockName after 3 retries');

      expect(mockTransactionsHelper.awaitSuccess).toHaveBeenCalledTimes(3);
    });
  });
});
