import {requireThat} from './store.mjs';
// A zero-value EVM transaction to the publisher's own address carries a versioned commitment.
// This proves inclusion of the receipt hash, not accuracy of the underlying construction work.
export function anchorData(sha256) {
  requireThat(/^[a-f0-9]{64}$/.test(sha256),'Invalid receipt hash.',400);
  return '0x'+Buffer.from('UNION-RECEIPT-v1:'+sha256,'utf8').toString('hex');
}
export async function verifyAnchor({rpc,txHash,receiptHash,chainId,publisher,confirmations=12}) {
  requireThat(/^0x[a-fA-F0-9]{64}$/.test(txHash),'Invalid transaction hash.',400);
  requireThat(/^0x[a-fA-F0-9]{40}$/.test(publisher),'Publisher wallet not configured.',503);
  requireThat(Number.isSafeInteger(confirmations)&&confirmations>=12,'At least 12 confirmations required.',503);
  requireThat(Number(BigInt(await rpc('eth_chainId',[])))===chainId,'Wrong chain.',400);
  const tx=await rpc('eth_getTransactionByHash',[txHash]);
  const receipt=await rpc('eth_getTransactionReceipt',[txHash]);
  requireThat(tx && receipt && receipt.status==='0x1' && receipt.blockNumber,'Transaction is not confirmed.');
  requireThat(tx.hash.toLowerCase()===txHash.toLowerCase() && receipt.transactionHash.toLowerCase()===txHash.toLowerCase() &&
    tx.from.toLowerCase()===publisher.toLowerCase() && tx.to?.toLowerCase()===publisher.toLowerCase() &&
    tx.input.toLowerCase()===anchorData(receiptHash) && BigInt(tx.value)===0n,'Transaction does not anchor this receipt.',400);
  const head=BigInt(await rpc('eth_blockNumber',[]));
  const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
  requireThat(block?.hash===receipt.blockHash && tx.blockHash===receipt.blockHash,'Transaction is not in the canonical chain.');
  requireThat(head-BigInt(receipt.blockNumber)+1n>=BigInt(confirmations),'More confirmations are required.');
  return {chainId,txHash,blockHash:receipt.blockHash,blockNumber:Number(BigInt(receipt.blockNumber)),receiptSha256:receiptHash,confirmations};
}
