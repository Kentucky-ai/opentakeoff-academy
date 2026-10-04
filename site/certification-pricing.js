import {normalizeOffers} from './commerce-model.js';
try {
  const response=await fetch('data/certification-offers.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error();
  const offers=normalizeOffers(await response.json());
  for(const offer of offers){
    const card=document.querySelector(`[data-offer="${offer.tier}"]`);if(!card)continue;
    card.querySelector('[data-price]').textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(offer.amountCents/100);
    card.querySelector('[data-offer-status]').textContent=offer.paymentLink?'Stripe checkout available':'Request now · payment link follows when checkout opens';
    const link=card.querySelector('[data-enroll]');link.href=`enroll.html?tier=${offer.tier}`;link.textContent=offer.paymentLink?'Start paid assessment ↗':'Request this assessment →';
  }
}catch{
  const error=document.getElementById('pricing-status');error.textContent='Online booking is unavailable. You can still request an assessment through the intake form.';
}
