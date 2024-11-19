import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageApproved, MessageApprovedStatus } from '@prisma/client';
import { AxelarGmpApi, BinaryUtils, TransactionsHelper } from '@stacks-monorepo/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksTestnet } from '@stacks/network';
import { ContractCallPayload, cvToValue, makeContractCall, StacksTransaction } from '@stacks/transactions';
import { MessageApprovedProcessorModule, MessageApprovedProcessorService } from '../src/message-approved-processor';

const SIGNER = '6d78de7b0625dfbfc16c3a8a5735f6dc3dc3f2ce';
const CHAIN_ID = 2147483648;

describe('MessageApprovedProcessorService', () => {
  let hiroApiHelper: DeepMocked<HiroApiHelper>;
  let transactionsHelper: DeepMocked<TransactionsHelper>;
  let axelarGmpApi: DeepMocked<AxelarGmpApi>;
  let prisma: PrismaService;
  let messageApprovedRepository: MessageApprovedRepository;

  let service: MessageApprovedProcessorService;

  let app: INestApplication;

  beforeEach(async () => {
    hiroApiHelper = createMock();
    transactionsHelper = createMock();
    axelarGmpApi = createMock();

    const moduleRef = await Test.createTestingModule({
      imports: [MessageApprovedProcessorModule],
    })
      .overrideProvider(HiroApiHelper)
      .useValue(hiroApiHelper)
      .overrideProvider(TransactionsHelper)
      .useValue(transactionsHelper)
      .overrideProvider(AxelarGmpApi)
      .useValue(axelarGmpApi)
      .overrideProvider(ProviderKeys.STACKS_NETWORK)
      .useValue(new StacksTestnet())
      .compile();

    prisma = await moduleRef.get(PrismaService);
    messageApprovedRepository = await moduleRef.get(MessageApprovedRepository);

    service = await moduleRef.get(MessageApprovedProcessorService);

    // Mock general calls
    hiroApiHelper.getAccountBalance.mockResolvedValue({
      stx: {
        balance: '10000',
      },
    } as any);

    transactionsHelper.makeContractCall.mockImplementation(async (opts) => await makeContractCall(opts));

    // Reset database & cache
    await prisma.messageApproved.deleteMany();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await prisma.$disconnect();

    await app.close();
  });

  const createMessageApproved = async (extraData: Partial<MessageApproved> = {}): Promise<MessageApproved> => {
    await messageApprovedRepository.createOrUpdate({
      sourceAddress: 'sourceAddress',
      messageId: 'messageId',
      status: MessageApprovedStatus.PENDING,
      sourceChain: 'ethereum',
      contractAddress: 'SP1ZZ7G7R1R548DC7EBVKGWV83EBZXFNA00VDP5FH.contract_name',
      payloadHash: 'ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
      payload: Buffer.from('payload'),
      retry: 0,
      executeTxHash: null,
      updatedAt: new Date(),
      createdAt: new Date(),
      availableGasBalance: '0',
      ...extraData,
    });

    // @ts-ignore
    return await prisma.messageApproved.findUnique({
      where: {
        sourceChain_messageId: {
          sourceChain: extraData.sourceChain || 'ethereum',
          messageId: extraData.messageId || 'messageId',
        },
      },
    });
  };

  const assertArgs = (transaction: StacksTransaction, entry: MessageApproved) => {
    const payload = transaction.payload as ContractCallPayload;

    const sourceChain = cvToValue(payload.functionArgs[0]);
    const messageId = cvToValue(payload.functionArgs[1]);
    const sourceAddress = cvToValue(payload.functionArgs[2]);
    const payloadArg = cvToValue(payload.functionArgs[3]).slice(2);

    expect(payload.functionName.content).toBe('execute');
    expect(sourceChain).toBe(entry.sourceChain);
    expect(messageId).toBe(entry.messageId);
    expect(sourceAddress).toBe(entry.sourceAddress);
    expect(payloadArg).toBe(entry.payload.toString('hex'));
  };

  it('Should send execute transaction two initial', async () => {
    const originalFirstEntry = await createMessageApproved();
    const originalSecondEntry = await createMessageApproved({
      sourceChain: 'polygon',
      messageId: 'messageId2',
      sourceAddress: 'otherSourceAddress',
      payload: Buffer.from('otherPayload'),
    });

    transactionsHelper.sendTransactions.mockImplementation((transactions: StacksTransaction[]): Promise<string[]> => {
      return Promise.resolve(transactions.map((transaction: StacksTransaction) => transaction.txid()));
    });

    await service.processPendingMessageApproved();

    expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);

    // Assert transactions data is correct
    const transactions = transactionsHelper.sendTransactions.mock.lastCall?.[0] as StacksTransaction[];
    expect(transactions).toHaveLength(2);

    expect(transactions[0].chainId).toBe(CHAIN_ID);
    expect(transactions[0].auth.spendingCondition.signer).toBe(SIGNER);
    assertArgs(transactions[0], originalFirstEntry);

    expect(transactions[1].chainId).toBe(CHAIN_ID);
    expect(transactions[1].auth.spendingCondition.signer).toBe(SIGNER);
    assertArgs(transactions[1], originalSecondEntry);

    // No contract call approved pending
    expect(await messageApprovedRepository.findPending()).toEqual([]);

    // Expect entries in database updated
    const firstEntry = await messageApprovedRepository.findBySourceChainAndMessageId(
      originalFirstEntry.sourceChain,
      originalFirstEntry.messageId,
    );
    expect(firstEntry).toEqual({
      ...originalFirstEntry,
      retry: 1,
      executeTxHash: expect.any(String),
      updatedAt: expect.any(Date),
    });

    const secondEntry = await messageApprovedRepository.findBySourceChainAndMessageId(
      originalSecondEntry.sourceChain,
      originalSecondEntry.messageId,
    );
    expect(secondEntry).toEqual({
      ...originalSecondEntry,
      retry: 1,
      executeTxHash: expect.any(String),
      updatedAt: expect.any(Date),
    });
  });

  it('Should send execute transaction retry one processed one failed', async () => {
    // Entries will be processed
    const originalFirstEntry = await createMessageApproved({
      retry: 1,
      updatedAt: new Date(new Date().getTime() - 360_000),
    });
    const originalSecondEntry = await createMessageApproved({
      sourceChain: 'polygon',
      messageId: 'messageId2',
      sourceAddress: 'otherSourceAddress',
      payload: Buffer.from('otherPayload'),
      retry: 3,
      updatedAt: new Date(new Date().getTime() - 360_000),
      taskItemId: '0191ead2-2234-7310-b405-76e787415031',
    });
    // Entry will not be processed (updated too early)
    const originalThirdEntry = await createMessageApproved({
      messageId: 'messageId3',
      retry: 1,
    });

    transactionsHelper.sendTransactions.mockImplementation((transactions: StacksTransaction[]): Promise<string[]> => {
      return Promise.resolve(transactions.map((transaction: StacksTransaction) => transaction.txid()));
    });

    axelarGmpApi.postEvents.mockImplementation(() => {
      return Promise.resolve();
    });

    await service.processPendingMessageApproved();

    expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);

    // Assert transactions data is correct
    const transactions = transactionsHelper.sendTransactions.mock.lastCall?.[0] as StacksTransaction[];
    expect(transactions).toHaveLength(1);

    expect(transactions[0].chainId).toBe(CHAIN_ID);
    expect(transactions[0].auth.spendingCondition.signer).toBe(SIGNER);
    assertArgs(transactions[0], originalFirstEntry);

    // No contract call approved pending remained
    expect(await messageApprovedRepository.findPending()).toEqual([]);

    // Expect entries in database updated
    const firstEntry = await messageApprovedRepository.findBySourceChainAndMessageId(
      originalFirstEntry.sourceChain,
      originalFirstEntry.messageId,
    );
    expect(firstEntry).toEqual({
      ...originalFirstEntry,
      retry: 2,
      executeTxHash: expect.any(String),
      updatedAt: expect.any(Date),
    });

    const secondEntry = await messageApprovedRepository.findBySourceChainAndMessageId(
      originalSecondEntry.sourceChain,
      originalSecondEntry.messageId,
    );
    expect(secondEntry).toEqual({
      ...originalSecondEntry,
      status: MessageApprovedStatus.FAILED,
      updatedAt: expect.any(Date),
    });

    expect(axelarGmpApi.postEvents).toHaveBeenCalledTimes(1);
    // @ts-ignore
    expect(axelarGmpApi.postEvents.mock.lastCall[0][0]).toEqual({
      type: 'CANNOT_EXECUTE_MESSAGE',
      eventID: originalSecondEntry.messageId,
      taskItemID: originalSecondEntry.taskItemId,
      reason: 'ERROR',
      details: 'CANNOT_EXECUTE_MESSAGE',
    });

    // Was not updated
    const thirdEntry = await messageApprovedRepository.findBySourceChainAndMessageId(
      originalThirdEntry.sourceChain,
      originalThirdEntry.messageId,
    );
    expect(thirdEntry).toEqual({
      ...originalThirdEntry,
    });
  });

  it('Should send execute transaction not successfully sent', async () => {
    const originalFirstEntry = await createMessageApproved();
    const originalSecondEntry = await createMessageApproved({
      sourceChain: 'polygon',
      messageId: 'messageId2',
      sourceAddress: 'otherSourceAddress',
      payload: Buffer.from('otherPayload'),
      retry: 2,
      updatedAt: new Date(new Date().getTime() - 360_000),
    });

    transactionsHelper.sendTransactions.mockImplementation((): Promise<string[]> => {
      return Promise.resolve([]);
    });

    await service.processPendingMessageApproved();

    expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);

    // Assert transactions data is correct
    const transactions = transactionsHelper.sendTransactions.mock.lastCall?.[0] as StacksTransaction[];
    expect(transactions).toHaveLength(2);

    assertArgs(transactions[0], originalFirstEntry);
    assertArgs(transactions[1], originalSecondEntry);

    // 2 are still pending because of proxy error
    expect(await messageApprovedRepository.findPending()).toEqual([]);

    // Expect entries in database to NOT be updated
    const firstEntry = await messageApprovedRepository.findBySourceChainAndMessageId(
      originalFirstEntry.sourceChain,
      originalFirstEntry.messageId,
    );
    expect(firstEntry).toEqual({
      ...originalFirstEntry,
      retry: 1, // retry is set to 1
      updatedAt: expect.any(Date),
    });

    const secondEntry = await messageApprovedRepository.findBySourceChainAndMessageId(
      originalSecondEntry.sourceChain,
      originalSecondEntry.messageId,
    );
    expect(secondEntry).toEqual({
      ...originalSecondEntry,
      retry: 2, // retry stays the same
      updatedAt: expect.any(Date),
    });
  });

  function mockProxySendTransactionsSuccess() {
    transactionsHelper.sendTransactions.mockImplementation((transactions): Promise<string[]> => {
      return Promise.resolve(transactions.map((transaction: StacksTransaction) => transaction.txid()));
    });
  }

  describe('ITS execute', () => {
    const contractAddress = 'ST319CF5WV77KYR1H3GT0GZ7B8Q4AQPY42ETP1VPF.contract_name';

    it('Should send execute transaction one deploy interchain token one other', async () => {
      const originalItsExecuteOther = await createMessageApproved({
        contractAddress,
        payload: Buffer.from('1'.toString().padStart(64, '0'), 'hex'),
      });
      const originalItsExecute = await createMessageApproved({
        contractAddress,
        sourceChain: 'polygon',
        sourceAddress: 'otherSourceAddress',
        payload: Buffer.from('1'.toString().padStart(64, '0'), 'hex'),
      });

      mockProxySendTransactionsSuccess();

      await service.processPendingMessageApproved();

      expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);

      // Assert transactions data is correct
      const transactions = transactionsHelper.sendTransactions.mock.lastCall?.[0] as StacksTransaction[];
      expect(transactions).toHaveLength(2);

      expect(transactions[0].chainId).toBe(CHAIN_ID);
      expect(transactions[0].auth.spendingCondition.signer).toBe(SIGNER);
      assertArgs(transactions[0], originalItsExecuteOther);

      expect(transactions[1].chainId).toBe(CHAIN_ID);
      expect(transactions[1].auth.spendingCondition.signer).toBe(SIGNER);
      assertArgs(transactions[1], originalItsExecute);

      // No contract call approved pending
      expect(await messageApprovedRepository.findPending()).toEqual([]);

      // Expect entries in database updated
      const itsExecuteOther = await messageApprovedRepository.findBySourceChainAndMessageId(
        originalItsExecuteOther.sourceChain,
        originalItsExecuteOther.messageId,
      );
      expect(itsExecuteOther).toEqual({
        ...originalItsExecuteOther,
        retry: 1,
        executeTxHash: expect.any(String),
        updatedAt: expect.any(Date),
        successTimes: null,
      });

      const itsExecute = await messageApprovedRepository.findBySourceChainAndMessageId(
        originalItsExecute.sourceChain,
        originalItsExecute.messageId,
      );
      expect(itsExecute).toEqual({
        ...originalItsExecute,
        retry: 1,
        executeTxHash: expect.any(String),
        updatedAt: expect.any(Date),
        successTimes: null,
      });
    });

    it('Should send execute transaction deploy interchain token 2 times', async () => {
      const originalItsExecute = await createMessageApproved({
        contractAddress,
        sourceChain: 'polygon',
        sourceAddress: 'otherSourceAddress',
        payload: Buffer.from('1'.toString().padStart(64, '0'), 'hex'),
      });

      mockProxySendTransactionsSuccess();

      await service.processPendingMessageApproved();

      expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);

      // Assert transactions data is correct
      let transactions = transactionsHelper.sendTransactions.mock.lastCall?.[0] as StacksTransaction[];
      expect(transactions).toHaveLength(1);

      expect(transactions[0].chainId).toBe(2147483648);
      expect(transactions[0].auth.spendingCondition.signer).toBe(SIGNER);
      assertArgs(transactions[0], originalItsExecute);

      // No contract call approved pending
      expect(await messageApprovedRepository.findPending()).toEqual([]);

      // @ts-ignore
      let itsExecute: MessageApproved = await messageApprovedRepository.findBySourceChainAndMessageId(
        originalItsExecute.sourceChain,
        originalItsExecute.messageId,
      );
      expect(itsExecute).toEqual({
        ...originalItsExecute,
        retry: 1,
        executeTxHash: expect.any(String),
        updatedAt: expect.any(Date),
        successTimes: null,
      });

      // Mark as last updated more than 1 minute ago
      itsExecute.updatedAt = new Date(new Date().getTime() - 60_500);
      await prisma.messageApproved.update({
        where: {
          sourceChain_messageId: {
            sourceChain: itsExecute.sourceChain,
            messageId: itsExecute.messageId,
          },
        },
        data: itsExecute,
      });

      // Mock 1st transaction executed successfully
      transactionsHelper.awaitSuccess.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          success: true,
          transaction: {
            ...transactions[0],
            status: 'success',
          },
        }),
      );

      // Process transaction 2nd time
      await service.processPendingMessageApproved();

      transactions = transactionsHelper.sendTransactions.mock.lastCall?.[0] as StacksTransaction[];
      expect(transactions).toHaveLength(1);
      // expect(transactions[0].getValue()).toBe(50000000000000000n); // assert sent with value 2nd time

      itsExecute = (await messageApprovedRepository.findBySourceChainAndMessageId(
        originalItsExecute.sourceChain,
        originalItsExecute.messageId,
      )) as MessageApproved;
      expect(itsExecute).toEqual({
        ...originalItsExecute,
        retry: 1,
        executeTxHash: expect.any(String),
        updatedAt: expect.any(Date),
        successTimes: null,
      });

      // Mark as last updated more than 1 minute ago
      itsExecute.updatedAt = new Date(new Date().getTime() - 60_500);
      await prisma.messageApproved.update({
        where: {
          sourceChain_messageId: {
            sourceChain: itsExecute.sourceChain,
            messageId: itsExecute.messageId,
          },
        },
        data: itsExecute,
      });

      // Process transaction 3rd time will retry transaction not sent
      transactionsHelper.sendTransactions.mockReturnValueOnce(Promise.resolve([]));

      await service.processPendingMessageApproved();

      transactions = transactionsHelper.sendTransactions.mock.lastCall?.[0] as StacksTransaction[];
      expect(transactions).toHaveLength(1);
      // expect(transactions[0].getValue()).toBe(50000000000000000n); // assert sent with value

      itsExecute = (await messageApprovedRepository.findBySourceChainAndMessageId(
        originalItsExecute.sourceChain,
        originalItsExecute.messageId,
      )) as MessageApproved;
      expect(itsExecute).toEqual({
        ...originalItsExecute,
        retry: 1,
        executeTxHash: '5c39fca59c40e1340cb622ed135e884cba0e4ee499a2b4f776a02dc49ab8b2f6',
        updatedAt: expect.any(Date),
        successTimes: null,
      });

      // Mark as last updated more than 1 minute ago
      itsExecute.updatedAt = new Date(new Date().getTime() - 60_500);
      await prisma.messageApproved.update({
        where: {
          sourceChain_messageId: {
            sourceChain: itsExecute.sourceChain,
            messageId: itsExecute.messageId,
          },
        },
        data: itsExecute,
      });

      // Process transaction 3rd time will retry transaction sent
      mockProxySendTransactionsSuccess();

      await service.processPendingMessageApproved();

      transactions = transactionsHelper.sendTransactions.mock.lastCall?.[0] as StacksTransaction[];
      expect(transactions).toHaveLength(1);
      // expect(transactions[0].getValue()).toBe(50000000000000000n); // assert sent with value

      itsExecute = (await messageApprovedRepository.findBySourceChainAndMessageId(
        originalItsExecute.sourceChain,
        originalItsExecute.messageId,
      )) as MessageApproved;
      expect(itsExecute).toEqual({
        ...originalItsExecute,
        retry: 1,
        executeTxHash: expect.any(String),
        updatedAt: expect.any(Date),
        successTimes: null,
      });
    });
  });
});
