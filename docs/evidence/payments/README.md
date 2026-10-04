# Assessment purchase and bounty intake review

October 3, 2026. Owner-approved assessment prices: Apprentice $100, Journeyman $200, Master $300 USD. Owner-selected bounty release rule: customer acceptance.

- [Price cards](pricing-desktop.png)
- [Master enrollment on mobile](enrollment-mobile.png)
- [Hosted review version](https://6ac179eb1377cbdf01114810--opentakeoff-academy.netlify.app/certification#assessment-pricing)

## Verified

```sh
npm run test:commerce
node --check site/enroll.js
node --check site/certification-pricing.js
node --check site/commerce-model.js
git diff --check
```

11 tests passed, 0 failed. These cover the owner-approved exact USD amounts, missing/duplicate tiers, unconfigured checkouts, allowed Stripe link origin, rejection of production test links, removal of arbitrary link parameters, reference validation, invalid price handling, ordered tier comparisons, and a return page that cannot infer paid/certified status from URL parameters.

Browser observations: choosing Journeyman opened the $200 registration; Master selected $300. At 390 × 844 the enrollment document had 390px scroll width and no horizontal page overflow. A local HTTP failure preserved entered registration details, showed an error, and did not open a payment or claim success. No registrations, charges or messages were submitted to the live service during testing.

On the hosted preview, certification, enrollment, next steps, bounties and offer JSON returned HTTP 200. Netlify's read-only API confirmed registration of `paid-certification` and the expanded `propose-bounty` fields, including credential tier, deadline, acceptance criteria and customer-acceptance release rule.

## Not yet active / not verified

All three `paymentLink` values are null, intentionally. Stripe account setup is in progress with the owner; no actual certification products or working checkout links have been created yet. Stripe payment completion and receipt reconciliation have not been tested end to end. This change is a hosted review version, not a claim that payments are live.

Bounty funding, escrow custody, agent claims, customer authentication, payment release and refunds are not implemented or enabled. Provider selection is pending. The bounty page explains the intended customer-acceptance lifecycle and collects an unfunded proposal. Stripe Connect is delayed payout, not legal escrow; the licensed provider considered has inspection-deadline behavior that must be resolved before adoption.

See [payment implementation and activation notes](../../PAYMENTS.md).
