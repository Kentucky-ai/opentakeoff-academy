import pg from 'pg';
import Stripe from 'stripe';
import {Store} from '../../server/store.mjs';
import {Services} from '../../server/services.mjs';
import {createHandler} from '../../server/http.mjs';
const env=process.env;
const config={origin:'https://union.kentucky-ai.com',paymentsEnabled:env.UNION_PAYMENTS_ENABLED==='true',
  liveMode:env.UNION_STRIPE_MODE==='live',termsVersion:env.UNION_TERMS_VERSION,
  webhookSecret:env.STRIPE_WEBHOOK_SECRET,adminToken:env.UNION_ADMIN_TOKEN,
  chainId:Number(env.UNION_CHAIN_ID)||null,publisher:env.UNION_PUBLISHER_ADDRESS};
const stripe=env.STRIPE_SECRET_KEY?new Stripe(env.STRIPE_SECRET_KEY,{maxNetworkRetries:2,timeout:15000}):null;
const pool=env.UNION_DATABASE_URL?new pg.Pool({connectionString:env.UNION_DATABASE_URL,max:2,connectionTimeoutMillis:5000,query_timeout:25000}):null;
const services=pool?new Services({store:new Store(pool),stripe,config}):null;
const rpc=env.UNION_RPC_URL?async(method,params)=>{
  const response=await fetch(env.UNION_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
  const body=await response.json();if(!response.ok||body.error)throw new Error('RPC unavailable');return body.result;
}:null;
export default createHandler({services,stripe,config,rpc});

