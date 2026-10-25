import {Fault, requireThat, hash} from './store.mjs';
export const TERMS_VERSION = 'union-services-draft-2026-10-25';
export function validateQuote(input) {
  const q = {};
  for (const name of ['title','scope','acceptanceCriteria','customerEmail','providerName','providerAccount','dueAt','termsVersion']) {
    requireThat(typeof input[name] === 'string' && input[name].trim().length > 0 && input[name].length <= 5000, `Invalid ${name}.`,400);
    q[name] = input[name].trim();
  }
  requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.customerEmail), 'Invalid email.',400);
  requireThat(/^acct_[A-Za-z0-9]+$/.test(q.providerAccount),'Invalid connected account.',400);
  requireThat(Number.isFinite(Date.parse(q.dueAt)) && Date.parse(q.dueAt)>Date.now(),'Future deadline required.',400);
  for (const key of ['amountCents','providerAmountCents']) {
    requireThat(Number.isSafeInteger(input[key]) && input[key] >= 50 && input[key] <= 1000000,`Invalid ${key}.`,400); q[key]=input[key];
  }
  requireThat(q.providerAmountCents <= q.amountCents,'Provider amount exceeds customer total.',400);
  // Operator must verify qualification for this scope; a public listing alone is insufficient.
  requireThat(input.qualificationVerified === true,'Verify provider qualification before quoting.',400);
  q.qualificationVerified = true;
  return q;
}
export function publicOrder(o) {
  // Customer and provider both see the commercial scope; never return tokens or operational identifiers.
  const keys = ['id','title','scope','acceptanceCriteria','providerName','dueAt','termsVersion','amountCents',
    'currency','state','revision','delivery','acceptedHash','acceptedAt','receipt','anchor','disputeReason'];
  return Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,o[k]]));
}
export function receiptFor(o) {
  requireThat(o.state==='released','Receipt requires confirmed transfer.');
  // Random order ID + private delivery hash are committed together. No PII or source documents on chain.
  const payload={version:1,domain:'union.kentucky-ai.com',orderId:o.id,deliverableSha256:o.acceptedHash,
    acceptedAt:o.acceptedAt,currency:o.currency,amountCents:o.amountCents,transferId:o.transferId};
  const canonical=JSON.stringify(payload);
  return {payload,canonical,sha256:hash(canonical)};
}
export class Services {
  constructor({store,stripe,config,now=()=>new Date().toISOString()}) { Object.assign(this,{store,stripe,config,now}); }
  ready() {
    requireThat(this.config.paymentsEnabled === true && this.stripe && this.config.webhookSecret && this.config.termsVersion &&
      this.config.termsVersion!==TERMS_VERSION,'Payments are not activated. Your request can still be reviewed.',503);
  }
  async read(id,role,token) { return this.store.locked(id,role,token,o=>publicOrder(o)); }
  async checkout(id,token,termsVersion) {
    this.ready();
    return this.store.locked(id,'customer',token,async(o,db,audit)=>{
      requireThat(o.state==='quoted','This quote cannot be funded.');
      requireThat(termsVersion===o.termsVersion && termsVersion===this.config.termsVersion,'Review the current agreement before paying.');
      requireThat(Date.parse(o.dueAt)>Date.now(),'Quote deadline has passed.');
      const account=await this.stripe.accounts.retrieve(o.providerAccount);
      requireThat(account.payouts_enabled && account.capabilities?.transfers==='active','Provider onboarding is incomplete.',503);
      if(o.sessionId) {
        const current=await this.stripe.checkout.sessions.retrieve(o.sessionId);
        if(current.status==='open') return {url:current.url};
        throw new Fault(409,'Checkout has closed. Operator reconciliation is required before retrying.');
      }
      const session=await this.stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],
        customer_email:o.customerEmail,client_reference_id:o.id,
        line_items:[{price_data:{currency:'usd',unit_amount:o.amountCents,product_data:{name:o.title}},quantity:1}],
        metadata:{union_order:o.id,terms_version:o.termsVersion},
        payment_intent_data:{metadata:{union_order:o.id},transfer_group:'union_'+o.id},
        success_url:this.config.origin+'/service-order.html?id='+o.id,
        cancel_url:this.config.origin+'/service-order.html?id='+o.id,
      },{idempotencyKey:'union-checkout-'+o.id});
      requireThat(session.livemode===this.config.liveMode,'Stripe mode does not match deployment.',503);
      o.sessionId=session.id;o.termsAcceptedAt=this.now();await audit('checkout_created'); return {url:session.url};
    });
  }
  async delivery(id,token,input) {
    return this.store.locked(id,'provider',token,async(o,db,audit)=>{
      requireThat(['funded','revision_requested'].includes(o.state),'Delivery requires funding or a requested revision.');
      requireThat(/^[a-f0-9]{64}$/.test(input.sha256),'A SHA-256 deliverable hash is required.',400);
      let url;try{url=new URL(input.url);}catch{throw new Fault(400,'Invalid delivery URL.');}
      requireThat(url.protocol==='https:'&&!url.username&&!url.password,'Use an HTTPS delivery link without credentials.',400);
      requireThat(input.url.length<=2000,'Delivery URL is too long.',400);
      o.delivery={sha256:input.sha256,url:url.href,submittedAt:this.now()};o.revision++;o.state='submitted';
      await audit('delivery_submitted',{sha256:input.sha256,revision:o.revision});return publicOrder(o);
    });
  }
  async decide(id,token,input) {
    return this.store.locked(id,'customer',token,async(o,db,audit)=>{
      requireThat(['accept','revise','dispute'].includes(input.action),'Unknown decision.',400);
      if(input.action==='dispute') {
        requireThat(['funded','submitted','revision_requested','accepted'].includes(o.state),'Contact support: this state cannot open a pre-release dispute.');
        requireThat(typeof input.reason==='string'&&input.reason.trim().length>=10&&input.reason.length<=3000,'Describe the issue.',400);
        o.state='disputed';o.disputeReason=input.reason.trim();await audit('customer_disputed');return publicOrder(o);
      }
      requireThat(o.state==='submitted','Only a submitted delivery can be reviewed.');
      requireThat(input.sha256===o.delivery.sha256 && input.revision===o.revision,'The delivery changed; review the latest version.');
      if(input.action==='accept') {o.state='accepted';o.acceptedHash=o.delivery.sha256;o.acceptedAt=this.now();await audit('customer_accepted',{sha256:o.acceptedHash,revision:o.revision});}
      else {o.state='revision_requested';await audit('revision_requested');}
      return publicOrder(o);
    });
  }
  async webhook(event) {
    requireThat(event.livemode===this.config.liveMode,'Wrong Stripe event mode.',400);
    const obj=event.data.object;
    if(!['checkout.session.completed','checkout.session.async_payment_succeeded','charge.dispute.created','charge.refunded'].includes(event.type)) return {ignored:true};
    let id=obj.metadata?.union_order, eventCharge=obj;
    if(event.type==='charge.dispute.created') {
      const charge=await this.stripe.charges.retrieve(typeof obj.charge==='string'?obj.charge:obj.charge.id);
      eventCharge=charge;
      id=charge.metadata?.union_order;
    }
    if(!id) return {ignored:true};
    return this.store.locked(id,'stripe',null,async(o,db,audit)=>{
      const inserted=await db.query('INSERT INTO union_events(id,order_id,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',[event.id,id,event.type]);
      if(!inserted.rows.length)return {duplicate:true};
      if(event.type.startsWith('checkout.session.')) {
        const s=await this.stripe.checkout.sessions.retrieve(obj.id,{expand:['payment_intent.latest_charge']});
        requireThat(s.id===o.sessionId && s.client_reference_id===o.id && s.metadata?.union_order===o.id &&
          s.livemode===this.config.liveMode && s.amount_total===o.amountCents && s.currency==='usd' && s.mode==='payment','Payment does not match order.',400);
        if(s.payment_status!=='paid') {await audit('payment_not_yet_paid');return {pending:true};}
        const pi=s.payment_intent,charge=pi?.latest_charge;
        requireThat(pi?.status==='succeeded' && charge?.paid && charge.captured && charge.amount===o.amountCents &&
          !charge.refunded && !charge.disputed && charge.amount_refunded===0,'Charge is not available for this order.',409);
        if(o.state==='quoted') {o.state='funded';o.paymentIntentId=pi.id;o.chargeId=charge.id;await audit('funding_confirmed');}
      } else {
        requireThat(eventCharge.id===o.chargeId && eventCharge.currency===o.currency && eventCharge.amount===o.amountCents &&
          eventCharge.livemode===this.config.liveMode,'Charge event does not belong to this funded order.',400);
        // A refund/chargeback after release is an exception requiring operator recovery, not a silent rewind.
        o.state=o.transferId?'settlement_exception':event.type==='charge.refunded'?(obj.amount_refunded===o.amountCents?'refunded':'settlement_exception'):'disputed';
        await audit(event.type);
      }
      return {received:true};
    });
  }
  async release(id) {
    this.ready();
    // Commit intent BEFORE contacting Stripe. Retrying a crash cannot create a new financial operation.
    await this.store.locked(id,'operator',null,async(o,db,audit)=>{
      if(o.state==='released')return;
      requireThat(['accepted','release_pending'].includes(o.state),'Only explicit customer acceptance permits release.');
      if(o.state==='accepted') {o.state='release_pending';o.releaseRequestedAt=this.now();await audit('release_requested');}
      requireThat(Date.now()-Date.parse(o.releaseRequestedAt)<23*3600000,'Release needs operator reconciliation; idempotency retry window expired.');
    });
    // Lock serializes local disputes with release. Later card chargebacks remain a recovery obligation.
    return this.store.locked(id,'operator',null,async(o,db,audit)=>{
      if(o.state==='released')return publicOrder(o);
      requireThat(o.state==='release_pending','Release is blocked by the current order state.');
      const charge=await this.stripe.charges.retrieve(o.chargeId);
      requireThat(charge.paid && charge.captured && !charge.disputed && !charge.refunded && charge.amount_refunded===0 &&
        charge.amount===o.amountCents && charge.currency==='usd' && charge.livemode===this.config.liveMode,'Charge cannot be released.');
      const account=await this.stripe.accounts.retrieve(o.providerAccount);
      requireThat(account.payouts_enabled && account.capabilities?.transfers==='active','Provider payouts are unavailable.');
      const transfer=await this.stripe.transfers.create({amount:o.providerAmountCents,currency:'usd',destination:o.providerAccount,
        source_transaction:o.chargeId,transfer_group:'union_'+o.id,metadata:{union_order:o.id}}, {idempotencyKey:'union-release-'+o.id});
      requireThat(transfer.amount===o.providerAmountCents && transfer.currency==='usd' && transfer.destination===o.providerAccount &&
        transfer.livemode===this.config.liveMode && !transfer.reversed,'Transfer response needs reconciliation.');
      o.transferId=transfer.id;o.state='released';o.releasedAt=this.now();o.receipt=receiptFor(o);
      await audit('transfer_confirmed',{transferId:transfer.id});return publicOrder(o);
    });
  }
  async refund(id,reason) {
    this.ready();
    requireThat(typeof reason==='string'&&reason.trim().length>=10&&reason.length<=3000,'Record the refund resolution.',400);
    await this.store.locked(id,'operator',null,async(o,db,audit)=>{
      requireThat(['funded','submitted','revision_requested','disputed','refund_pending'].includes(o.state)&&!o.transferId,'Only unreleased funded orders can use this refund route.');
      if(o.state!=='refund_pending'){o.state='refund_pending';o.refundRequestedAt=this.now();await audit('refund_requested',{reason});}
      requireThat(Date.now()-Date.parse(o.refundRequestedAt)<23*3600000,'Refund needs operator reconciliation; retry window expired.');
    });
    return this.store.locked(id,'operator',null,async(o,db,audit)=>{
      requireThat(o.state==='refund_pending','Refund state changed.');
      const refund=await this.stripe.refunds.create({payment_intent:o.paymentIntentId,amount:o.amountCents,metadata:{union_order:o.id}},
        {idempotencyKey:'union-refund-'+o.id});
      requireThat(refund.amount===o.amountCents && refund.currency==='usd','Refund response needs reconciliation.');
      o.refundId=refund.id;if(refund.status==='succeeded')o.state='refunded';
      await audit('refund_provider_response',{refundId:refund.id,status:refund.status});return publicOrder(o);
    });
  }

}
