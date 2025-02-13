import { sha512_256 } from '@noble/hashes/sha512';
import { bufferCV, BytesReader, deserializeTransaction, listCV, tupleCV, uintCV } from '@stacks/transactions';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { ItsError } from '@stacks-monorepo/common/contracts/entities/its.error';

function tagged_sha512_256(tag: Uint8Array, data: Uint8Array): Uint8Array {
  return sha512_256(new Uint8Array([...tag, ...data]));
}

// https://github.com/stacks-network/stacks-core/blob/eb865279406d0700474748dc77df100cba6fa98e/stacks-common/src/util/hash.rs
export class MerkleTree {
  static MERKLE_PATH_LEAF_TAG = new Uint8Array([0x00]);
  static MERKLE_PATH_NODE_TAG = new Uint8Array([0x01]);

  nodes: Uint8Array[][];

  constructor(nodes: Uint8Array[][] = []) {
    this.nodes = nodes;
  }

  static empty(): MerkleTree {
    return new MerkleTree();
  }

  static new(data: Uint8Array[]): MerkleTree {
    if (data.length === 0) {
      return this.empty();
    }

    const leaf_hashes: Uint8Array[] = data.map((buf) => MerkleTree.getLeafHash(buf));

    // force even number
    if (leaf_hashes.length % 2 !== 0) {
      const dup = leaf_hashes[leaf_hashes.length - 1];
      leaf_hashes.push(dup);
    }

    const nodes: Uint8Array[][] = [leaf_hashes];

    while (true) {
      const current_level = nodes[nodes.length - 1];
      const next_level: Uint8Array[] = [];

      for (let i = 0; i < current_level.length; i += 2) {
        if (i + 1 < current_level.length) {
          next_level.push(MerkleTree.getNodeHash(current_level[i], current_level[i + 1]));
        } else {
          next_level.push(current_level[i]);
        }
      }

      // at root
      if (next_level.length === 1) {
        nodes.push(next_level);
        break;
      }

      // force even number
      if (next_level.length % 2 !== 0) {
        const dup = next_level[next_level.length - 1];
        next_level.push(dup);
      }

      nodes.push(next_level);
    }

    return new MerkleTree(nodes);
  }

  static getLeafHash(leaf_data: Uint8Array): Uint8Array {
    return tagged_sha512_256(MerkleTree.MERKLE_PATH_LEAF_TAG, leaf_data);
  }

  static getNodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
    return tagged_sha512_256(MerkleTree.MERKLE_PATH_NODE_TAG, new Uint8Array([...left, ...right]));
  }

  proof(index: number) {
    if (this.nodes.length === 0) {
      return [];
    }
    if (index > this.nodes[0].length - 1) {
      throw new ItsError('Index out of bounds');
    }
    const depth = this.nodes.length - 1;
    const path = Math.pow(2, depth) + index;

    const proof = [];
    let position = index;
    for (let level = 0; level < depth; ++level) {
      const left = ((1 << level) & path) > 0;
      proof.push(this.nodes[level][position + (left ? -1 : 1)]);
      position = ~~(position / 2);
    }

    return proof;
  }
}

export function getBlockHeader(blockRaw: Buffer, txIndex: number) {
  const block = new Uint8Array(blockRaw);

  const block_version = block.slice(0, 1);
  const chain_length = block.slice(1, 9);
  const burn_spent = block.slice(9, 17);
  const consensus_hash = block.slice(17, 37);
  const parent_block_id = block.slice(37, 69);
  const tx_merkle_root = block.slice(69, 101);
  const state_root = block.slice(101, 133);
  const timestamp = block.slice(133, 141);
  const miner_signature = block.slice(141, 206);
  const signatureCount = Number('0x' + bytesToHex(block.slice(206, 210)));
  const pastSignatures = 210 + signatureCount * 65;
  // const signerBitVecLen = Number("0x" + bytesToHex(block.slice(pastSignatures, pastSignatures + 2)))
  const signerBitVecByteLen = Number('0x' + bytesToHex(block.slice(pastSignatures + 2, pastSignatures + 6)));
  const signer_bitvec = block.slice(pastSignatures, pastSignatures + 6 + signerBitVecByteLen);

  const txs = block.slice(pastSignatures + 10 + signerBitVecByteLen);
  const txids = deserializeRawBlockTxs(txs);
  const tx_merkle_tree = MerkleTree.new(txids.map(hexToBytes));

  const blockHeader = new Uint8Array([
    ...block_version,
    ...chain_length,
    ...burn_spent,
    ...consensus_hash,
    ...parent_block_id,
    ...tx_merkle_root,
    ...state_root,
    ...timestamp,
    ...miner_signature,
    ...signer_bitvec,
  ]);

  const proof = tx_merkle_tree.proof(txIndex);

  return { proof, blockHeader };
}

export function proofPathToCV(tx_index: number, hashes: Uint8Array[], tree_depth: number) {
  return tupleCV({
    'tx-index': uintCV(tx_index),
    hashes: listCV(hashes.map(bufferCV)),
    'tree-depth': uintCV(tree_depth),
  });
}

function deserializeRawBlockTxs(txs: Uint8Array | BytesReader, processedTxs: string[] = []) {
  const { transaction, reader } = deserializeTransactionCustom(txs instanceof BytesReader ? txs : new BytesReader(txs));

  processedTxs = processedTxs.concat(transaction.txid());

  if (reader.consumed === reader.source.length) {
    return processedTxs;
  }
  return deserializeRawBlockTxs(reader, processedTxs);
}

function deserializeTransactionCustom(bytesReader: BytesReader) {
  const transaction = deserializeTransaction(bytesReader);
  return { transaction, reader: bytesReader };
}
