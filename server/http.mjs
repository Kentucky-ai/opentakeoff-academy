import {Fault,requireThat,equalSecret} from './store.mjs';
import {validateQuote,publicOrder} from './services.mjs';
import {anchorData,verifyAnchor} from './anchor.mjs';
export const UCP_VERSION='2026-08-25';
export function profile(origin) {
  // Valid discovery with no false claim of shopping checkout or agent-authorized payments.
  // This custom capability describes a human-reviewed construction-service handoff.
  return {ucp:{version:UCP_VERSION,services:{'com.kentucky-ai.union':[{version:'2026-10-25',transport:'rest',
    endpoint:origin+'/api/union',spec:origin+'/service-protocol.html',schema:origin+'/data/service-api.openapi.json'}]},
    capabilities:{'com.kentucky-ai.union.service_handoff':[{version:'2026-10-25',spec:origin+'/service-protocol.html',
      schema:origin+'/data/service-handoff.schema.json'}]},payment_handlers:{}}};
}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createHandler({services,config,stripe,rpc}) {
  return async request=>{
    try {
      const url=new URL(request.url),path=url.pathname.replace(/^\/api\/union/,'').replace(/^\/\.netlify\/functions\/union/,'');
      const method=request.method;
      if(method==='GET'&&path==='/status')return json({intake:'open',payments:config.paymentsEnabled&&services&&stripe&&config.webhookSecret&&config.termsVersion?'configured_unverified':'not_activated',
        database:Boolean(services),onChain:config.chainId&&config.publisher?'configured':'not_activated',termsVersion:config.termsVersion||null});
      if(method==='GET'&&(path==='/profile'||path==='/.well-known/ucp'))return json(profile(config.origin));
      if(method==='GET'&&path==='/handoff')return json({ucp:{version:UCP_VERSION,capabilities:{'com.kentucky-ai.union.service_handoff':[{version:'2026-10-25'}]},payment_handlers:{}},
        status:'requires_human_review',request_url:config.origin+'/request-service.html',publisher_url:config.origin+'/publish.html',
        payment_status:'not_requested',message:'Submit scope, systems and acceptance criteria. A reviewed agreement is required before funding.'});
      requireThat(services,'The operational backend is not configured. Submit a service request for review.',503);
      requireThat(method==='GET'||method==='POST','Method not supported.',405);
      if(method==='POST'&&path!=='/stripe-webhook') {
        const origin=request.headers.get('origin');
        requireThat(!origin||origin===config.origin,'Cross-origin requests are not allowed.',403);
        requireThat(request.headers.get('content-type')?.startsWith('application/json'),'Use application/json.',415);
      }
      requireThat(Number(request.headers.get('content-length')||0)<=32768,'Request too large.',413);
      const raw=method==='POST'?await request.text():'';requireThat(Buffer.byteLength(raw)<=32768,'Request too large.',413);
      if(path==='/stripe-webhook'&&method==='POST') {
        requireThat(config.webhookSecret&&stripe,'Webhook not configured.',503);
        let event;try{event=stripe.webhooks.constructEvent(raw,request.headers.get('stripe-signature'),config.webhookSecret);}catch{throw new Fault(400,'Invalid webhook signature.');}
        return json(await services.webhook(event));
      }
      let body={};if(raw){try{body=JSON.parse(raw);}catch{throw new Fault(400,'Invalid JSON.');}}
      const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
      const admin=()=>requireThat(config.adminToken&&equalSecret(token,config.adminToken),'Operator authentication required.',401);
      if(path==='/quotes'&&method==='POST') {admin();return json(await services.store.create(validateQuote(body)),201);}
      const match=path.match(/^\/orders\/([0-9a-f-]{36})(?:\/(checkout|delivery|decision|release|refund|anchor))?$/);
      requireThat(match,'Route not found.',404);
      const [,id,action]=match;
      const role=request.headers.get('x-union-role')||'customer';requireThat(['customer','provider'].includes(role),'Invalid role.',400);
      if(!action&&method==='GET')return json(await services.read(id,role,token));
      requireThat(method==='POST','Method not supported.',405);
      if(action==='checkout')return json(await services.checkout(id,token,body.termsVersion));
      if(action==='delivery')return json(await services.delivery(id,token,body));
      if(action==='decision')return json(await services.decide(id,token,body));
      if(action==='release') {admin();return json(await services.release(id));}
      if(action==='refund') {admin();return json(await services.refund(id,body.reason));}
      if(action==='anchor') {
        admin();requireThat(config.chainId&&config.publisher&&rpc,'On-chain publisher is not configured.',503);
        return json(await services.store.locked(id,'operator',null,async(o,db,audit)=>{
          requireThat(o.state==='released'&&o.receipt,'Release must be confirmed before anchoring.');
          if(!body.txHash)return {chainId:config.chainId,to:config.publisher,value:'0x0',data:anchorData(o.receipt.sha256),receiptSha256:o.receipt.sha256};
          o.anchor=await verifyAnchor({rpc,txHash:body.txHash,receiptHash:o.receipt.sha256,chainId:config.chainId,publisher:config.publisher});
          await audit('anchor_verified',o.anchor);return publicOrder(o);
        }));
      }
      throw new Fault(404,'Route not found.');
    } catch(error) {
      // Do not leak Stripe responses, customer identifiers, tokens or database URLs.
      return json({error:error instanceof Fault?error.message:'Unable to complete the operation. Contact Union with the order reference.'},error instanceof Fault?error.status:500);
    }
  };
}
