import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { MessageApprovedStatus, StacksTransactionStatus, StacksTransactionType } from '@prisma/client';
import { ApiConfigService, CacheInfo } from '@stacks-monorepo/common';
import { AxelarGmpApi } from '@stacks-monorepo/common/api/axelar.gmp.api';
import {
  Components,
  ConstructProofTask,
  ReactToExpiredSigningSessionTask,
  VerifyTask,
} from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { ApprovalsProcessorService } from './approvals.processor.service';
import { PendingCosmWasmTransaction } from './entities/pending-cosm-wasm-transaction';
import { CosmwasmService } from './cosmwasm.service';
import { LastProcessedDataRepository } from '@stacks-monorepo/common/database/repository/last-processed-data.repository';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { StacksTransactionRepository } from '@stacks-monorepo/common/database/repository/stacks-transaction.repository';
import GatewayTransactionTask = Components.Schemas.GatewayTransactionTask;
import TaskItem = Components.Schemas.TaskItem;
import RefundTask = Components.Schemas.RefundTask;
import ExecuteTask = Components.Schemas.ExecuteTask;
import ReactToRetriablePollTask = Components.Schemas.ReactToRetriablePollTask;

const mockDate = new Date('2023-05-14');
jest.useFakeTimers().setSystemTime(mockDate);

const STACKS_ITS_CONTRACT = 'stacksContract';
const AXELAR_ITS_CONTRACT = 'axelarItsContract';
const AXELAR_MULTISIG_PROVER_CONTRACT = 'axelarultisigProverContract';
const AXELAR_GATEWAY_CONTRACT = 'axelarGatewayContract';

describe('ApprovalsProcessorService', () => {
  let axelarGmpApi: DeepMocked<AxelarGmpApi>;
  let redisHelper: DeepMocked<RedisHelper>;
  let messageApprovedRepository: DeepMocked<MessageApprovedRepository>;
  let lastProcessedDataRepository: DeepMocked<LastProcessedDataRepository>;
  let apiConfigService: DeepMocked<ApiConfigService>;
  let slackApi: DeepMocked<SlackApi>;
  let stacksTransactionRepository: DeepMocked<StacksTransactionRepository>;

  let service: ApprovalsProcessorService;

  beforeEach(async () => {
    axelarGmpApi = createMock();
    redisHelper = createMock();
    messageApprovedRepository = createMock();
    lastProcessedDataRepository = createMock();
    apiConfigService = createMock();
    slackApi = createMock();
    stacksTransactionRepository = createMock();

    apiConfigService.getContractItsProxy.mockReturnValue(STACKS_ITS_CONTRACT);
    apiConfigService.getAxelarContractIts.mockReturnValue(AXELAR_ITS_CONTRACT);
    apiConfigService.getAxelarMultisigProverContract.mockReturnValue(AXELAR_MULTISIG_PROVER_CONTRACT);
    apiConfigService.getAxelarGatewayContract.mockReturnValue(AXELAR_GATEWAY_CONTRACT);

    const moduleRef = await Test.createTestingModule({
      providers: [ApprovalsProcessorService],
    })
      .useMocker((token) => {
        if (token === AxelarGmpApi) {
          return axelarGmpApi;
        }

        if (token === RedisHelper) {
          return redisHelper;
        }

        if (token === MessageApprovedRepository) {
          return messageApprovedRepository;
        }

        if (token === LastProcessedDataRepository) {
          return lastProcessedDataRepository;
        }

        if (token === ApiConfigService) {
          return apiConfigService;
        }

        if (token === CosmwasmService) {
          return new CosmwasmService(redisHelper, axelarGmpApi, apiConfigService, slackApi);
        }

        if (token === SlackApi) {
          return slackApi;
        }

        if (token === StacksTransactionRepository) {
          return stacksTransactionRepository;
        }

        return null;
      })
      .compile();

    lastProcessedDataRepository.get.mockImplementation(() => {
      return Promise.resolve(undefined);
    });

    service = moduleRef.get(ApprovalsProcessorService);
  });

  describe('handleNewTasks', () => {
    it('Should handle get tasks error', async () => {
      axelarGmpApi.getTasks.mockRejectedValueOnce(new Error('Network error'));
      await service.handleNewTasksRaw();
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(1);
    });

    it('Should handle get tasks as long as there are tasks', async () => {
      const refundTask: RefundTask = {
        refundRecipientAddress: '',
        remainingGasBalance: {
          amount: '0',
        },
        message: {
          messageID: '',
          payloadHash: '',
          sourceChain: '',
          sourceAddress: '',
          destinationAddress: '',
        },
      };

      // @ts-ignore
      axelarGmpApi.getTasks.mockImplementation((_, lastTaskUUID) => {
        let tasks: TaskItem[] = [];
        if (lastTaskUUID !== 'lastUUID1') {
          tasks = [
            {
              type: 'REFUND',
              task: refundTask,
              id: 'lastUUID1',
              timestamp: '1234',
              chain: '',
            },
          ];
        }
        return Promise.resolve({
          data: {
            tasks,
          },
        });
      });

      await service.handleNewTasksRaw();

      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', undefined);
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith('lastTaskUUID', 'lastUUID1');
      expect(stacksTransactionRepository.createOrUpdate).toHaveBeenCalledTimes(1);
      expect(stacksTransactionRepository.createOrUpdate).toHaveBeenCalledWith({
        type: StacksTransactionType.REFUND,
        status: StacksTransactionStatus.PENDING,
        extraData: refundTask,
        taskItemId: 'lastUUID1',
        retry: 0,
      });
    });
    it('Should handle gateway tx task', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [
                {
                  type: 'GATEWAY_TX',
                  task: {
                    executeData: 'mockExecuteData',
                  } as GatewayTransactionTask,
                  id: 'UUID',
                  timestamp: '1234',
                },
              ],
            },
          }),
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
            },
          }),
        );

      await service.handleNewTasksRaw();

      expect(lastProcessedDataRepository.get).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', undefined);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', 'UUID');
      expect(lastProcessedDataRepository.update).toHaveBeenCalledTimes(1);
      expect(stacksTransactionRepository.createOrUpdate).toHaveBeenCalledWith({
        type: StacksTransactionType.GATEWAY,
        status: StacksTransactionStatus.PENDING,
        extraData: {
          executeData: 'mockExecuteData',
        },
        taskItemId: 'UUID',
        retry: 0,
      });
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith('lastTaskUUID', 'UUID');
    });

    it('Should handle execute task', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [
                {
                  type: 'EXECUTE',
                  task: {
                    payload: Buffer.from('0123', 'hex').toString('base64'),
                    availableGasBalance: {
                      amount: '0',
                    },
                    message: {
                      messageID: 'messageId',
                      destinationAddress: 'destinationAddress',
                      sourceAddress: 'sourceAddress',
                      sourceChain: 'ethereum',
                      payloadHash: Buffer.from('0234', 'hex').toString('base64'),
                    },
                  } as ExecuteTask,
                  id: 'UUID',
                  timestamp: '1234',
                },
              ],
            },
          }),
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
            },
          }),
        );
      await service.handleNewTasksRaw();
      expect(messageApprovedRepository.createOrUpdate).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.createOrUpdate).toHaveBeenCalledWith({
        sourceChain: 'ethereum',
        messageId: 'messageId',
        status: MessageApprovedStatus.PENDING,
        sourceAddress: 'sourceAddress',
        contractAddress: 'destinationAddress',
        payloadHash: '0234',
        payload: Buffer.from('0123', 'hex'),
        retry: 0,
        taskItemId: 'UUID',
        availableGasBalance: '0',
      });
      expect(lastProcessedDataRepository.update).toHaveBeenCalledTimes(1);
    });

    it('Should handle execute task invalid gas token', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [
                {
                  type: 'EXECUTE',
                  task: {
                    payload: Buffer.from('0123', 'hex').toString('base64'),
                    availableGasBalance: {
                      tokenID: 'other',
                      amount: '100',
                    },
                    message: {
                      messageID: 'messageId',
                      destinationAddress: 'destinationAddress',
                      sourceAddress: 'sourceAddress',
                      sourceChain: 'ethereum',
                      payloadHash: Buffer.from('0234', 'hex').toString('base64'),
                    },
                  } as ExecuteTask,
                  id: 'UUID',
                  timestamp: '1234',
                },
              ],
            },
          }),
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
            },
          }),
        );

      await service.handleNewTasksRaw();

      expect(messageApprovedRepository.createOrUpdate).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.createOrUpdate).toHaveBeenCalledWith({
        sourceChain: 'ethereum',
        messageId: 'messageId',
        status: MessageApprovedStatus.PENDING,
        sourceAddress: 'sourceAddress',
        contractAddress: 'destinationAddress',
        payloadHash: '0234',
        payload: Buffer.from('0123', 'hex'),
        retry: 0,
        taskItemId: 'UUID',
        availableGasBalance: '0',
      });
      expect(lastProcessedDataRepository.update).toHaveBeenCalledTimes(1);
    });

    it('Should not save last task uuid if error', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [
                {
                  type: 'GATEWAY_TX',
                  task: {
                    executeData: 'mockExecuteData',
                  } as GatewayTransactionTask,
                  id: 'UUID',
                  timestamp: '1234',
                },
              ],
            },
          }),
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
            },
          }),
        );
      stacksTransactionRepository.createOrUpdate.mockRejectedValueOnce(new Error('Network error'));

      await service.handleNewTasksRaw();

      expect(lastProcessedDataRepository.update).not.toHaveBeenCalledTimes(1);
      // Mock lastUUID
      lastProcessedDataRepository.get.mockImplementation(() => {
        return Promise.resolve('lastUUID1');
      });
      // Will start processing tasks from lastUUID1
      await service.handleNewTasksRaw();
      expect(lastProcessedDataRepository.get).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', 'lastUUID1');
    });
  });

  describe('handleConstructProof', () => {
    it('should add a single entry in Redis for construct_proof_with_payload', async () => {
      const response: ConstructProofTask = {
        message: {
          sourceChain: 'axelar',
          messageID: 'msg1',
          sourceAddress: AXELAR_ITS_CONTRACT,
          destinationAddress: 'someDestination',
          payloadHash: Buffer.from('payloadHash1').toString('base64'),
        },
        payload: Buffer.from('payloadData').toString('base64'),
      };

      await service.processConstructProofTask(response);

      expect(redisHelper.set).toHaveBeenCalledWith(
        `pendingCosmWasm:proof_axelar_msg1`,
        {
          request: {
            construct_proof_with_payload: [
              {
                message_id: {
                  source_chain: response.message.sourceChain,
                  message_id: response.message.messageID,
                },
                payload: Buffer.from('payloadData').toString('hex'),
              },
            ],
          },
          retry: 0,
          type: 'CONSTRUCT_PROOF',
          timestamp: mockDate.getTime(),
        },
        604800,
      );
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('should not add a single entry in Redis for construct_proof', async () => {
      const response = {
        message: {
          sourceChain: 'otherChain',
          messageID: 'msg2',
          sourceAddress: 'randomAddress',
          destinationAddress: 'anotherDestination',
          payloadHash: Buffer.from('payloadHash2').toString('base64'),
        },
        payload: Buffer.from('payloadData').toString('base64'),
      };

      await service.processConstructProofTask(response);

      expect(redisHelper.set).not.toHaveBeenCalled();
    });
  });

  describe('handleVerify', () => {
    it('should add a single entry in Redis for verify_message_with_payload', async () => {
      const response: VerifyTask = {
        message: {
          sourceChain: 'stacks',
          messageID: 'msg1',
          sourceAddress: STACKS_ITS_CONTRACT,
          destinationAddress: AXELAR_ITS_CONTRACT,
          payloadHash: Buffer.from('payloadHash1').toString('base64'),
        },
        payload: Buffer.from('payloadData').toString('base64'),
        destinationChain: 'axelar',
      };

      await service.processVerifyTask(response);

      expect(redisHelper.set).toHaveBeenCalledWith(
        `pendingCosmWasm:verify_stacks_msg1`,
        {
          request: {
            verify_message_with_payload: [
              {
                message: {
                  cc_id: {
                    source_chain: response.message.sourceChain,
                    message_id: response.message.messageID,
                  },
                  destination_chain: 'axelar',
                  destination_address: AXELAR_ITS_CONTRACT,
                  source_address: STACKS_ITS_CONTRACT,
                  payload_hash: Buffer.from('payloadHash1').toString('hex'),
                },
                payload: Buffer.from('payloadData').toString('hex'),
              },
            ],
          },
          retry: 0,
          type: 'VERIFY',
          timestamp: mockDate.getTime(),
        },
        604800,
      );
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('should not add a single entry in Redis for verify_messages', async () => {
      const response: VerifyTask = {
        message: {
          sourceChain: 'stacks',
          messageID: 'msg2',
          sourceAddress: 'randomAddress',
          destinationAddress: 'anotherDestination',
          payloadHash: Buffer.from('payloadHash2').toString('base64'),
        },
        payload: Buffer.from('payloadData').toString('base64'),
        destinationChain: 'ethereum',
      };

      await service.processVerifyTask(response);

      expect(redisHelper.set).not.toHaveBeenCalled();
    });
  });

  describe('handleReactToExpiredSigningSession', () => {
    it('should add a single entry in Redis for construct_proof_with_payload', async () => {
      const response: ReactToExpiredSigningSessionTask = {
        sessionID: 1,
        broadcastID: 'broadcastID',
        invokedContractAddress: 'invokedContractAddress',
        requestPayload: 'payload',
      };

      await service.processReactToExpiredSigningSession(response);

      expect(redisHelper.set).toHaveBeenCalledWith(
        `pendingCosmWasm:retry_proof_invokedContractAddress_1`,
        {
          request: 'payload',
          retry: 0,
          type: 'CONSTRUCT_PROOF',
          timestamp: mockDate.getTime(),
        },
        604800,
      );
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleReactToRetriablePool', () => {
    it('should add a single entry in Redis for verify_message_with_payload', async () => {
      const response: ReactToRetriablePollTask = {
        pollID: 1,
        broadcastID: 'broadcastID',
        invokedContractAddress: 'invokedContractAddress',
        requestPayload: 'payload',
        quorumReachedEvents: [],
      };

      await service.processReactToRetriablePoll(response);

      expect(redisHelper.set).toHaveBeenCalledWith(
        `pendingCosmWasm:retry_verify_invokedContractAddress_1`,
        {
          request: 'payload',
          retry: 0,
          type: 'VERIFY',
          timestamp: mockDate.getTime(),
        },
        604800,
      );
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleCosmWasmTransaction', () => {
    it('should process and remove transaction if broadcast status is SUCCESS', async () => {
      const key = CacheInfo.PendingCosmWasmTransaction('axelar_msg1').key;
      const pendingProof: PendingCosmWasmTransaction = {
        request: { construct_proof: [{ source_chain: 'axelar', message_id: 'msg1' }] },
        retry: 0,
        broadcastID: 'broadcastID1',
        type: 'CONSTRUCT_PROOF',
        timestamp: 1234,
      };

      axelarGmpApi.getMsgExecuteContractBroadcastStatus.mockResolvedValue('SUCCESS');

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);

      await service.handlePendingCosmWasmTransactionRaw();

      expect(redisHelper.delete).toHaveBeenCalledWith(key);
      expect(redisHelper.delete).toHaveBeenCalledTimes(1);
    });

    it('should retry transaction broadcast if still pending', async () => {
      const id = 'axelar_msg1';
      const key = CacheInfo.PendingCosmWasmTransaction(id).key;
      const pendingProof: PendingCosmWasmTransaction = {
        request: { construct_proof: [{ source_chain: 'axelar', message_id: 'msg2' }] },
        retry: 0,
        broadcastID: 'broadcastID2',
        type: 'CONSTRUCT_PROOF',
        timestamp: mockDate.getTime(),
      };

      axelarGmpApi.getMsgExecuteContractBroadcastStatus.mockResolvedValue('RECEIVED');

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);

      await service.handlePendingCosmWasmTransactionRaw();

      expect(axelarGmpApi.getMsgExecuteContractBroadcastStatus).toHaveBeenCalledTimes(1);

      expect(redisHelper.delete).not.toHaveBeenCalled();
      expect(redisHelper.set).not.toHaveBeenCalled();
    });

    it('should retry transaction broadcast if status is not SUCCESS', async () => {
      const id = 'axelar_msg1';
      const key = CacheInfo.PendingCosmWasmTransaction(id).key;
      const pendingProof: PendingCosmWasmTransaction = {
        request: { construct_proof: [{ source_chain: 'axelar', message_id: 'msg2' }] },
        retry: 0,
        broadcastID: 'broadcastID2',
        type: 'CONSTRUCT_PROOF',
        timestamp: 1234,
      };

      axelarGmpApi.getMsgExecuteContractBroadcastStatus.mockResolvedValue('ERROR');

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);

      await service.handlePendingCosmWasmTransactionRaw();

      expect(redisHelper.set).toHaveBeenCalledWith(
        key,
        {
          ...pendingProof,
          broadcastID: undefined,
          retry: 1,
          timestamp: mockDate.getTime(),
        },
        CacheInfo.PendingCosmWasmTransaction(id).ttl,
      );
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('should handle new broadcast if no broadcastID is set construct proof', async () => {
      const id = 'axelar_msg3';
      const key = CacheInfo.PendingCosmWasmTransaction(id).key;
      const pendingProof: PendingCosmWasmTransaction = {
        request: { construct_proof: [{ source_chain: 'axelar', message_id: 'msg3' }] },
        retry: 0,
        type: 'CONSTRUCT_PROOF',
        timestamp: 1234,
      };

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);
      axelarGmpApi.broadcastMsgExecuteContract.mockResolvedValue('newBroadcastID');

      await service.handlePendingCosmWasmTransactionRaw();

      expect(axelarGmpApi.broadcastMsgExecuteContract).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.broadcastMsgExecuteContract).toHaveBeenCalledWith(
        pendingProof.request,
        AXELAR_MULTISIG_PROVER_CONTRACT,
      );
      expect(redisHelper.set).toHaveBeenCalledWith(
        key,
        { ...pendingProof, broadcastID: 'newBroadcastID', timestamp: mockDate.getTime() },
        CacheInfo.PendingCosmWasmTransaction(id).ttl,
      );
    });

    it('should handle new broadcast if no broadcastID is set verify', async () => {
      const id = 'axelar_msg3';
      const key = CacheInfo.PendingCosmWasmTransaction(id).key;
      const pendingProof: PendingCosmWasmTransaction = {
        request: { verify_messages: [{ source_chain: 'axelar', message_id: 'msg3' }] },
        retry: 0,
        type: 'VERIFY',
        timestamp: 1234,
      };

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);
      axelarGmpApi.broadcastMsgExecuteContract.mockResolvedValue('newBroadcastID');

      await service.handlePendingCosmWasmTransactionRaw();

      expect(axelarGmpApi.broadcastMsgExecuteContract).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.broadcastMsgExecuteContract).toHaveBeenCalledWith(
        pendingProof.request,
        AXELAR_GATEWAY_CONTRACT,
      );
      expect(redisHelper.set).toHaveBeenCalledWith(
        key,
        { ...pendingProof, broadcastID: 'newBroadcastID', timestamp: mockDate.getTime() },
        CacheInfo.PendingCosmWasmTransaction(id).ttl,
      );
    });

    it('should delete transaction if maximum retries are reached', async () => {
      const id = 'axelar_msg4';
      const key = CacheInfo.PendingCosmWasmTransaction(id).key;
      const pendingProof: PendingCosmWasmTransaction = {
        request: { construct_proof: [{ source_chain: 'axelar', message_id: 'msg4' }] },
        retry: 3,
        type: 'CONSTRUCT_PROOF',
        timestamp: 1234,
      };

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);

      await service.handlePendingCosmWasmTransactionRaw();

      expect(redisHelper.delete).toHaveBeenCalledWith(key);
      expect(redisHelper.delete).toHaveBeenCalledTimes(1);
    });
  });
});
