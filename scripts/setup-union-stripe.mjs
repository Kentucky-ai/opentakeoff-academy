// Reads credentials from the process environment only. Never prints keys or account data.
import Stripe from 'stripe';
import {readFile,writeFile} from 'node:fs/promises';
import {PRICES,TIERS,normalizeOffers} from '../site/commerce-model.js';
const apply=process.argv.includes('--apply'),live=process.argv.includes('--live');
const key=process.env.STRIPE_SECRET_KEY;
if(!key)throw new Error('Configure STRIPE_SECRET_KEY in the protected environment first. Do not paste it into chat or commit it.');
if(!key.startsWith(live?'sk_live_':'sk_test_'))throw new Error('Key mode mismatch. Test mode is the default; live requires --live.');
const stripe=new Stripe(key,{maxNetworkRetries:2});
const account=await stripe.accounts.retrieve();
console.log(JSON.stringify({mode:live?'live':'test',chargesEnabled:account.charges_enabled,payoutsEnabled:account.payouts_enabled,detailsSubmitted:account.details_submitted}));
if(!apply){console.log('Read-only readiness check. --apply creates the three one-time assessment offers; --live --apply writes verified live links to the site.');process.exit(0);}
if(live&&(!account.charges_enabled||!account.payouts_enabled||!account.details_submitted))throw new Error('Complete merchant activation in Stripe before opening sales.');
if(live&&process.env.UNION_ASSESSMENT_TERMS_APPROVED!=='true')throw new Error('Confirm session availability, assessment/refund/retest terms and merchant identity before live setup.');
const file=new URL('../site/data/certification-offers.json',import.meta.url),offers=JSON.parse(await readFile(file,'utf8'));
for(const tier of TIERS){
 const id='union_assessment_'+tier+'_v1';
 let product;try{product=await stripe.products.retrieve(id);}catch(e){if(e.code!=='resource_missing')throw e;}
 if(!product)product=await stripe.products.create({id,name:'OpenTakeoff Academy — '+tier[0].toUpperCase()+tier.slice(1)+' human-proctored assessment',
  description:'Human-proctored takeoff assessment on real construction drawings. Payment does not guarantee passing, a badge or bounty work. Scheduling is coordinated by the Academy.',metadata:{union_tier:tier}},{idempotencyKey:id});
 const lookup=id+'_usd_'+PRICES[tier];
 const prices=await stripe.prices.list({lookup_keys:[lookup],active:true});
 const price=prices.data[0]||await stripe.prices.create({product:product.id,currency:'usd',unit_amount:PRICES[tier],lookup_key:lookup},{idempotencyKey:lookup});
 if(price.product!==product.id||price.currency!=='usd'||price.unit_amount!==PRICES[tier]||price.type!=='one_time')throw new Error('Existing Stripe price does not match approved offer.');
 // Pagination prevents accidentally creating a second active link after idempotency expiry.
 let link;for await(const candidate of stripe.paymentLinks.list({limit:100})){if(candidate.active&&candidate.metadata?.union_offer===lookup){link=candidate;break;}}
 if(!link)link=await stripe.paymentLinks.create({line_items:[{price:price.id,quantity:1}],metadata:{union_offer:lookup},
  after_completion:{type:'redirect',redirect:{url:'https://union.kentucky-ai.com/assessment-status.html'}}},{idempotencyKey:lookup+'_link'});
 const lines=await stripe.paymentLinks.listLineItems(link.id,{limit:10});
 if(lines.data.length!==1||lines.data[0].quantity!==1||lines.data[0].price.id!==price.id||link.livemode!==live)throw new Error('Payment link verification failed.');
 if(live)offers.offers.find(o=>o.tier===tier).paymentLink=link.url;
 console.log(JSON.stringify({tier,amountCents:PRICES[tier],mode:live?'live':'test',url:link.url}));
}
if(live){normalizeOffers(offers);await writeFile(file,JSON.stringify(offers,null,2)+'\n');console.log('Verified live links written. Review checkout pages and run test:commerce before deployment.');}
else console.log('Test links created; production offer configuration was not changed.');
