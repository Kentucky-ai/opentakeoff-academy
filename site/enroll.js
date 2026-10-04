import {normalizeOffers,checkoutUrl,TIERS} from './commerce-model.js';
const $=id=>document.getElementById(id),form=$('enrollment-form');
let offers=[],submitted=false;
const requested=new URLSearchParams(location.search).get('tier');
if(TIERS.includes(requested))$('assessment-tier').value=requested;
function selected(){return offers.find(offer=>offer.tier===$('assessment-tier').value);}
function showOffer(){
 const offer=selected();if(!offer)return;
 $('selected-tier').textContent=offer.name;$('selected-price').textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(offer.amountCents/100);
 $('assessment-price-usd').value=String(offer.amountCents/100);
 $('enroll-submit').textContent=offer.paymentLink?'Register & continue to payment ↗':'Request this assessment →';
 $('enrollment-availability').textContent=offer.paymentLink?'Stripe checkout is available. Registration is followed by payment.':'Online checkout is being set up. Submit your request now; no payment is collected here.';
 $('enroll-submit').disabled=false;
}
$('assessment-tier').addEventListener('change',showOffer);
try{
 const response=await fetch('data/certification-offers.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error();offers=normalizeOffers(await response.json());showOffer();
}catch{
 $('enroll-submit').disabled=true;$('enroll-submit').textContent='Booking unavailable';$('enroll-status').textContent='The assessment options could not be loaded. Please refresh or use the certification intake page.';
 const fallback=document.createElement('a');fallback.href='request-certification.html';fallback.textContent='Open certification intake →';$('enroll-status').append(' ',fallback);
}
form.addEventListener('submit',async event=>{
 event.preventDefault();if(submitted||!form.reportValidity())return;
 const offer=selected();if(!offer)return;
 // Opaque application reference contains no email, agent internals or credentials.
 if(!$('application-id').value)$('application-id').value='OTA-APP-'+crypto.randomUUID();
 const reference=$('application-id').value;
 $('enroll-submit').disabled=true;$('enroll-submit').textContent='Registering…';$('enroll-status').textContent='';
 try{
  const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(form)),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Registration was not accepted.');
  submitted=true;form.hidden=true;$('enrollment-next').hidden=false;$('reference-display').textContent=reference;
  if(offer.paymentLink){
   $('continue-payment').href=checkoutUrl(offer,reference);$('continue-payment').hidden=false;
   $('next-heading').textContent='Next: '+offer.name+' assessment payment';
   $('next-message').textContent='Your registration is recorded. Continue to the Stripe-hosted payment page. This registration is not proof of payment or certification.';
  }else{
   $('next-heading').textContent='Your assessment request is recorded.';
   $('next-message').textContent=`You requested the ${offer.name} assessment at $${offer.amountCents/100} USD. Online checkout is being configured. The Academy will coordinate the payment link and session details; nothing has been charged.`;
  }
  $('enrollment-next').focus();
 }catch{
  $('enroll-status').textContent='We could not confirm registration. Your entries are still here. Please retry; no payment was started.';showOffer();$('enroll-status').focus();
 }
});
