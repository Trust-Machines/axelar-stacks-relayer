import { HubMessage } from './hub.message';
import { DeployInterchainToken, InterchainTransfer } from './hub.message.types';
import { cvToHex, tupleCV, uintCV } from '@stacks/transactions';

describe('HubMessage Static Method Tests', () => {
  describe('clarityDecode Tests', () => {
    it('should decode Interchain Transfer message', () => {
      const payload =
        '0x0c0000000706616d6f756e740100000000000000000000000000000001046461746102000000001364657374696e6174696f6e2d616464726573730200000016051adcc241b7135be4bc59b133efe34e76f32475359c0e736f757263652d616464726573730200000016051adcc241b7135be4bc59b133efe34e76f32475359c0c736f757263652d636861696e0d00000006737461636b7308746f6b656e2d696402000000208fa3abdb6289970a569ab61d3bd93db89d21f7b99f98864a12d254230173c6e604747970650100000000000000000000000000000000';
      const encoded = HubMessage.clarityDecode(payload)!;

      expect(encoded).toBeDefined();
      expect(encoded.sourceChain).toEqual('stacks');

      const transfer = encoded.payload as InterchainTransfer;

      expect(transfer.messageType).toBe(0);
      expect(transfer.tokenId).toBe('0x8fa3abdb6289970a569ab61d3bd93db89d21f7b99f98864a12d254230173c6e6');
      expect(transfer.senderAddress).toBe('0x051adcc241b7135be4bc59b133efe34e76f32475359c');
      expect(transfer.destinationAddress).toBe('0x051adcc241b7135be4bc59b133efe34e76f32475359c');
      expect(transfer.amount).toBe('1');
      expect(transfer.data).toBe('0x');
    });
    it('should decode Deploy Interchain Token message', () => {
      const payload =
        '0x0c0000000708646563696d616c7301000000000000000000000000000000060c6d696e7465722d62797465730200000000046e616d650d0000000641584c4554480c736f757263652d636861696e0d0000000e6176616c616e6368652d66756a690673796d626f6c0d0000000641584c45544808746f6b656e2d69640200000020371e8414ed46fdd974d97f71a89a7b2e984ca6f86305470b9888b28a22434c8904747970650100000000000000000000000000000001';
      const encoded = HubMessage.clarityDecode(payload)!;

      expect(encoded).toBeDefined();
      expect(encoded.sourceChain).toEqual('avalanche-fuji');

      const transfer = encoded.payload as DeployInterchainToken;

      expect(transfer.messageType).toBe(1);
      expect(transfer.tokenId).toBe('0x371e8414ed46fdd974d97f71a89a7b2e984ca6f86305470b9888b28a22434c89');
      expect(transfer.name).toBe('AXLETH');
      expect(transfer.symbol).toBe('AXLETH');
      expect(transfer.decimals).toBe(6);
      expect(transfer.minter).toBe('0x');
    });
    it('should return null for unsupported message types', () => {
      const cv = tupleCV({
        'message-type': uintCV(64),
      });
      const encoded = HubMessage.clarityDecode(cvToHex(cv));
      expect(encoded).toBeNull();
    });
  });
});
