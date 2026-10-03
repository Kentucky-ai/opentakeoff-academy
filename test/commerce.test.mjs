import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeOffers,stripePaymentLink,checkoutUrl,tierMeetsRequirement} from '../site/commerce-model.js';
const config=JSON.parse(readFileSync(new URL('../site/data/certification-offers.json',import.meta.url)));
const clone=()=>JSON.parse(JSON.stringify(config));
const ref='OTA-APP-12345678-1234-1234-1234-123456789abc';
test('Michael’s USD certification prices are preserved exactly',()=>assert.deepEqual(normalizeOffers(config).map(o=>[o.tier,o.amountCents]),[['apprentice',10000],['journeyman',20000],['master',30000]]));
test('missing payment links remain unavailable, not fake checkout routes',()=>{
 for(const offer of normalizeOffers(config).filter(o=>!o.paymentLink))assert.throws(()=>checkoutUrl(offer,ref),/not open/);
});
test('amount mismatches cannot be silently published by the config loader',()=>{const data=clone();data.offers[0].amountCents=1;assert.throws(()=>normalizeOffers(data),/inconsistent/);});
test('duplicate or absent tiers are rejected',()=>{const data=clone();data.offers[1]=data.offers[0];assert.throws(()=>normalizeOffers(data),/inconsistent/);});
test('live checkout rejects sandbox links',()=>assert.throws(()=>stripePaymentLink('https://buy.stripe.com/test_example'),/Test payment/));
test('links must be Stripe-hosted HTTPS without credentials or unrelated paths',()=>{
 for(const url of ['http://buy.stripe.com/example','https://buy.stripe.com.evil.invalid/example','https://evil.invalid/example','javascript:alert(1)','https://user:pass@buy.stripe.com/example','https://buy.stripe.com:444/example','https://buy.stripe.com/','https://buy.stripe.com/example/more'])assert.throws(()=>stripePaymentLink(url));
});
test('untrusted payment-link query fields are stripped',()=>assert.equal(stripePaymentLink('https://buy.stripe.com/example?paid=true&locked_prefilled_email=private%40example.invalid#paid'),'https://buy.stripe.com/example'));
test('a valid reference is required and no personal details are put in the URL',()=>{
 const offer={tier:'apprentice',amountCents:10000,paymentLink:'https://buy.stripe.com/test_example'};
 for(const id of ['','person@example.invalid','OTA-APP-short'])assert.throws(()=>checkoutUrl(offer,id,{allowTest:true}),/reference/);
 const url=new URL(checkoutUrl(offer,ref,{allowTest:true}));assert.equal(url.searchParams.get('client_reference_id'),ref);assert.deepEqual([...url.searchParams.keys()],['client_reference_id','utm_source','utm_campaign']);
});
test('a changed amount cannot be passed through to checkout',()=>assert.throws(()=>checkoutUrl({tier:'master',amountCents:1,paymentLink:'https://buy.stripe.com/example'},ref),/Invalid assessment/));
test('tier comparisons are ordered and reject unknown credentials',()=>{
 assert.equal(tierMeetsRequirement('master','journeyman'),true);assert.equal(tierMeetsRequirement('apprentice','journeyman'),false);assert.equal(tierMeetsRequirement('paid','apprentice'),false);assert.equal(tierMeetsRequirement('master','unknown'),false);
});
test('return page never treats URL parameters as proof of payment or certification',()=>{
 const html=readFileSync(new URL('../site/assessment-status.html',import.meta.url),'utf8');
 assert.match(html,/This page cannot confirm a payment/);assert.match(html,/Payment does not create a credential/);assert.doesNotMatch(html,/<script/);
});
