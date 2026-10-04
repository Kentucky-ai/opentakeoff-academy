// These links start provider-hosted payments; no client-side action verifies payment.
export const TIERS = Object.freeze(['apprentice','journeyman','master']);
export const PRICES = Object.freeze({apprentice:10000,journeyman:20000,master:30000});
export function stripePaymentLink(value,{allowTest=false}={}) {
  if (!value) return null;
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='buy.stripe.com'||url.port||url.username||url.password||!/^\/[A-Za-z0-9_]+$/.test(url.pathname))throw new Error('Use the certification product’s Stripe Payment Link from buy.stripe.com.');
  if(url.pathname.startsWith('/test_')&&!allowTest)throw new Error('Test payment links cannot be used in live checkout.');
  // Configuration cannot set a payer identity or manufacture a paid state.
  url.search='';url.hash='';return url.toString();
}
export function normalizeOffers(raw,options={}) {
  if(raw?.version!==1||raw.currency!=='USD'||!Array.isArray(raw.offers)||raw.offers.length!==3)throw new Error('Certification offers could not be loaded.');
  return TIERS.map(tier=>{
    const matches=raw.offers.filter(offer=>offer.tier===tier);
    if(matches.length!==1||matches[0].amountCents!==PRICES[tier])throw new Error('Certification offer configuration is inconsistent.');
    const offer=matches[0];
    return {...offer,paymentLink:stripePaymentLink(offer.paymentLink,options)};
  });
}
export function checkoutUrl(offer,applicationId,options={}) {
  if(!TIERS.includes(offer?.tier)||offer.amountCents!==PRICES[offer.tier])throw new Error('Invalid assessment tier.');
  const link=stripePaymentLink(offer.paymentLink,options);
  if(!link)throw new Error('Online checkout is not open for this assessment yet.');
  if(!/^OTA-APP-[A-Za-z0-9-]{16,70}$/.test(applicationId))throw new Error('A valid application reference is required.');
  const url=new URL(link);url.searchParams.set('client_reference_id',applicationId);url.searchParams.set('utm_source','opentakeoff_academy');url.searchParams.set('utm_campaign',offer.tier+'_assessment');return url.toString();
}
export function tierMeetsRequirement(issuedTier,minimumTier) {
  // Caller MUST verify the credential signature, current standing and competency first.
  const issued=TIERS.indexOf(issuedTier),minimum=TIERS.indexOf(minimumTier);
  return issued>=0&&minimum>=0&&issued>=minimum;
}
