import {readFileSync,writeFileSync} from 'node:fs';
import {normalizeOffers,TIERS,stripePaymentLink} from '../site/commerce-model.js';
const [tier,link,...extra]=process.argv.slice(2);
if(!TIERS.includes(tier)||!link||extra.length){console.error('Usage: node scripts/set-certification-payment-link.mjs apprentice|journeyman|master https://buy.stripe.com/LIVE_LINK');process.exit(1);}
const url=new URL('../site/data/certification-offers.json',import.meta.url);
const config=JSON.parse(readFileSync(url,'utf8'));
normalizeOffers(config);
config.offers.find(offer=>offer.tier===tier).paymentLink=stripePaymentLink(link);
normalizeOffers(config);
writeFileSync(url,JSON.stringify(config,null,2)+'\n');
console.log(`Configured ${tier} checkout. Verify the Stripe product name, USD price, one-time billing and return URL before deploying.`);
