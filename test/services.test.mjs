import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import Stripe from 'stripe';
import {Store} from '../server/store.mjs';
import {Services,validateQuote,TERMS_VERSION} from '../server/services.mjs';
import {createHandler,profile} from '../server/http.mjs';
import {anchorData,verifyAnchor} from '../server/anchor.mjs';
const schema=await readFile(new URL('../server/schema.sql',import.meta.url),'utf8');
async function fixture(t){
 const db=new PGlite();await db.exec(schema);t.after(()=>db.close());const store=new Store(db);
 const config={origin:'https://union.kentucky-ai.com',paymentsEnabled:true,liveMode:false,termsVersion:'test-agreement-v1',adminToken:'a'.repeat(48),webhookSecret:'whsec_test'};
 const charge={id:'ch_test',paid:true,captured:true,refunded:false,disputed:false,amount_refunded:0,amount:10000,currency:'usd',livemode:false};
 const calls={transfers:0,checkout:0,refunds:0};let session;
 const stripe={accounts:{retrieve:async()=>({payouts_enabled:true,capabilities:{transfers:'active'}})},
 checkout:{sessions:{create:async args=>{calls.checkout++;session={id:'cs_test_union',status:'open',url:'https://checkout.stripe.com/c/pay/test',livemode:false,...args,amount_total:10000,currency:'usd',payment_status:'paid',payment_intent:{id:'pi_test',status:'succeeded',latest_charge:charge}};return session;},retrieve:async()=>session}},
 charges:{retrieve:async()=>charge},transfers:{create:async args=>{calls.transfers++;return {id:'tr_test',livemode:false,...args};}},
 refunds:{create:async args=>{calls.refunds++;return {id:'re_test',status:'succeeded',currency:'usd',...args};}},
 webhooks:new Stripe('sk_test_fixture').webhooks};
 const services=new Services({store,stripe,config});
 const q=validateQuote({title:'Integration test service',scope:'Produce a draft mapping; no ERP writes.',acceptanceCriteria:'All codes match the reviewed table.',customerEmail:'customer@example.test',providerName:'Test provider',providerAccount:'acct_fixture',dueAt:'2099-01-01T00:00:00Z',termsVersion:config.termsVersion,amountCents:10000,providerAmountCents:9000,qualificationVerified:true});
 const created=await store.create(q);const id=created.order.id,customer=created.customerToken,provider=created.providerToken;
 const event=()=>({id:'evt_funded',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_union',metadata:{union_order:id}}}});
 async function fund(){await services.checkout(id,customer,config.termsVersion);await services.webhook(event());}
 async function submit(){await fund();await services.delivery(id,provider,{sha256:'1'.repeat(64),url:'https://example.test/delivery'});}
 async function accept(){await submit();await services.decide(id,customer,{action:'accept',sha256:'1'.repeat(64),revision:1});}
 return {db,store,config,stripe,charge,calls,services,id,customer,provider,event,fund,submit,accept,session:()=>session};
}
test('quotes validate cents, recipient, deadline and reviewed qualification',()=>{
 assert.throws(()=>validateQuote({}),/Invalid title/);
});
test('private order keys are isolated, hashed at rest, and responses exclude contacts/payee identifiers',async t=>{
 const f=await fixture(t);await assert.rejects(f.services.read(f.id,'customer',f.provider),/Invalid order access/);
 const row=(await f.db.query('select * from union_orders')).rows[0];assert.notEqual(row.customer_hash,f.customer);
 const order=await f.services.read(f.id,'customer',f.customer);assert.equal(order.customerEmail,undefined);assert.equal(order.providerAccount,undefined);
});
test('disabled funding and draft agreements fail closed without contacting Stripe',async t=>{
 const f=await fixture(t);f.config.paymentsEnabled=false;await assert.rejects(f.services.checkout(f.id,f.customer,f.config.termsVersion),/not activated/);
 f.config.paymentsEnabled=true;f.config.termsVersion=TERMS_VERSION;await assert.rejects(f.services.checkout(f.id,f.customer,TERMS_VERSION),/not activated/);assert.equal(f.calls.checkout,0);
});
test('checkout requires current terms and onboarded payee; retries reuse the session',async t=>{
 const f=await fixture(t);await assert.rejects(f.services.checkout(f.id,f.customer,'old'),/agreement/);
 const ready=f.stripe.accounts.retrieve;f.stripe.accounts.retrieve=async()=>({payouts_enabled:false});
 await assert.rejects(f.services.checkout(f.id,f.customer,f.config.termsVersion),/onboarding/);f.stripe.accounts.retrieve=ready;
 await f.services.checkout(f.id,f.customer,f.config.termsVersion);await f.services.checkout(f.id,f.customer,f.config.termsVersion);assert.equal(f.calls.checkout,1);
});
test('signed payment is reconciled against authoritative amount and duplicates apply once',async t=>{
 const f=await fixture(t);await f.services.checkout(f.id,f.customer,f.config.termsVersion);f.session().amount_total=1;
 await assert.rejects(f.services.webhook(f.event()),/does not match/);assert.equal((await f.services.read(f.id,'customer',f.customer)).state,'quoted');
 f.session().amount_total=10000;await f.services.webhook(f.event());assert.deepEqual(await f.services.webhook(f.event()),{duplicate:true});
 assert.equal((await f.db.query("select * from union_audit where action='funding_confirmed'")).rows.length,1);
});
test('unpaid or wrong-mode events cannot fund work',async t=>{
 const f=await fixture(t);await f.services.checkout(f.id,f.customer,f.config.termsVersion);f.session().payment_status='unpaid';
 await f.services.webhook(f.event());assert.equal((await f.services.read(f.id,'customer',f.customer)).state,'quoted');
 await assert.rejects(f.services.webhook({...f.event(),livemode:true}),/Wrong Stripe/);
});
test('delivery requires funding; provider cannot accept; stale hashes/revisions fail',async t=>{
 const f=await fixture(t);await assert.rejects(f.services.delivery(f.id,f.provider,{sha256:'1'.repeat(64),url:'https://example.test'}),/funding/);
 await f.submit();await assert.rejects(f.services.decide(f.id,f.provider,{action:'accept'}),/Invalid order access/);
 await assert.rejects(f.services.decide(f.id,f.customer,{action:'accept',sha256:'2'.repeat(64),revision:1}),/delivery changed/);
 await assert.rejects(f.services.decide(f.id,f.customer,{action:'accept',sha256:'1'.repeat(64),revision:2}),/delivery changed/);
});
test('submission never releases; revision and dispute block transfers',async t=>{
 const f=await fixture(t);await f.submit();await assert.rejects(f.services.release(f.id),/acceptance/);
 await f.services.decide(f.id,f.customer,{action:'revise',sha256:'1'.repeat(64),revision:1});await assert.rejects(f.services.release(f.id),/acceptance/);
 await f.services.decide(f.id,f.customer,{action:'dispute',reason:'The mapping is incomplete.'});await assert.rejects(f.services.release(f.id),/acceptance/);assert.equal(f.calls.transfers,0);
});
test('acceptance releases exactly once and produces reproducible private receipt',async t=>{
 const f=await fixture(t);await f.accept();const order=await f.services.release(f.id);assert.equal(order.state,'released');assert.equal(order.receipt.sha256.length,64);
 assert.ok(!order.receipt.canonical.includes('customer@example'));await f.services.release(f.id);assert.equal(f.calls.transfers,1);
});
test('release intent survives network errors and expires before Stripe idempotency window',async t=>{
 const f=await fixture(t);await f.accept();f.stripe.transfers.create=async()=>{throw Error('network timeout');};
 await assert.rejects(f.services.release(f.id),/network timeout/);assert.equal((await f.services.read(f.id,'customer',f.customer)).state,'release_pending');
 await f.store.locked(f.id,'operator',null,o=>{o.releaseRequestedAt='2020-01-01T00:00:00Z';});
 await assert.rejects(f.services.release(f.id),/reconciliation/);
});
test('chargeback before release blocks money; chargeback after transfer creates recovery exception',async t=>{
 const f=await fixture(t);await f.accept();f.charge.disputed=true;await assert.rejects(f.services.release(f.id),/cannot be released/);assert.equal(f.calls.transfers,0);
 f.charge.disputed=false;await f.services.release(f.id);f.charge.metadata={union_order:f.id};
 await f.services.webhook({id:'evt_dispute',livemode:false,type:'charge.dispute.created',data:{object:{charge:'ch_test'}}});
 assert.equal((await f.services.read(f.id,'customer',f.customer)).state,'settlement_exception');
});
test('an unrelated signed refund event cannot alter a funded order',async t=>{
 const f=await fixture(t);await f.fund();
 const e={id:'evt_wrong_refund',livemode:false,type:'charge.refunded',data:{object:{...f.charge,id:'ch_other',metadata:{union_order:f.id},amount_refunded:10000}}};
 await assert.rejects(f.services.webhook(e),/does not belong/);assert.equal((await f.services.read(f.id,'customer',f.customer)).state,'funded');
});
test('operator refund is full, pre-release only, with a documented reason',async t=>{
 const f=await fixture(t);await f.fund();await assert.rejects(f.services.refund(f.id,'x'),/resolution/);
 const order=await f.services.refund(f.id,'Customer and provider agreed to cancel.');assert.equal(order.state,'refunded');assert.equal(f.calls.refunds,1);
 await assert.rejects(f.services.release(f.id),/acceptance/);
});
test('HTTP rejects unsigned webhooks, unauthorized operator actions and cross-origin mutations',async t=>{
 const f=await fixture(t);const handle=createHandler(f);
 const req=(path,body,headers={})=>new Request(f.config.origin+'/api/union'+path,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json',...headers}});
 assert.equal((await handle(req('/stripe-webhook',{}))).status,400);
 assert.equal((await handle(req('/quotes',{}))).status,401);
 assert.equal((await handle(req('/quotes',{}, {Origin:'https://evil.example'}))).status,403);
 await f.services.checkout(f.id,f.customer,f.config.termsVersion);const payload=JSON.stringify(f.event());
 const signature=f.stripe.webhooks.generateTestHeaderString({payload,secret:f.config.webhookSecret});
 const response=await handle(new Request(f.config.origin+'/api/union/stripe-webhook',{method:'POST',body:payload,headers:{'stripe-signature':signature}}));assert.equal(response.status,200);
});
test('UCP handoff advertises custom capability only; no payment handler or shopping checkout',async()=>{
 const config={origin:'https://union.kentucky-ai.com'},p=profile(config.origin);assert.equal(p.ucp.version,'2026-08-25');assert.deepEqual(p.ucp.payment_handlers,{});
 assert.equal(p.ucp.capabilities['dev.ucp.shopping.checkout'],undefined);
 const handle=createHandler({config});const r=await handle(new Request(config.origin+'/api/union/handoff'));assert.equal(r.status,200);assert.equal((await r.json()).payment_status,'not_requested');
 assert.equal((await handle(new Request(config.origin+'/.well-known/ucp'))).status,200);
 assert.equal((await handle(new Request(config.origin+'/api/union/orders/00000000-0000-0000-0000-000000000000'))).status,503);
});
test('chain receipt requires exact commitment, publisher, zero value, chain, canonical block and confirmations',async()=>{
 const publisher='0x'+'1'.repeat(40),txHash='0x'+'2'.repeat(64),receiptHash='3'.repeat(64),blockHash='0x'+'4'.repeat(64);
 const tx={hash:txHash,from:publisher,to:publisher,input:anchorData(receiptHash),value:'0x0',blockHash};
 const data={eth_chainId:'0x14a34',eth_getTransactionByHash:tx,eth_getTransactionReceipt:{status:'0x1',blockNumber:'0x10',transactionHash:txHash,blockHash},eth_blockNumber:'0x20',eth_getBlockByNumber:{hash:blockHash}};
 const args={rpc:async method=>data[method],txHash,receiptHash,chainId:84532,publisher};assert.equal((await verifyAnchor(args)).txHash,txHash);
 tx.input='0x00';await assert.rejects(verifyAnchor(args),/does not anchor/);tx.input=anchorData(receiptHash);
 tx.value='0x1';await assert.rejects(verifyAnchor(args),/does not anchor/);tx.value='0x0';
 data.eth_blockNumber='0x11';await assert.rejects(verifyAnchor(args),/More confirmations/);data.eth_blockNumber='0x20';
 data.eth_getBlockByNumber.hash='0x00';await assert.rejects(verifyAnchor(args),/canonical/);
});
