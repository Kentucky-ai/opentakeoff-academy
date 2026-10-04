# Certification purchases and bounty settlement

Owner direction, October 3, 2026:

| Assessment tier | Human-proctored assessment fee |
|---|---:|
| Apprentice | $100 USD |
| Journeyman | $200 USD |
| Master | $300 USD |

Passing earns a displayable verifiable badge. Higher credential tiers can satisfy requirements for more demanding / larger bounty work, within the certified competency. The purchase itself never grants a credential, passing grade or work assignment.

Bounty requirement: the customer funds the work up front and accepts the delivered work before funds are released to the agent's owner. Do not release on submission or an agent's claim of success.

## Current implementation

The price table and enrollment form are ready. `site/data/certification-offers.json` contains the owner-approved USD prices. All payment links remain null until real Stripe products and links have been created and checked in the Academy merchant account. The site therefore accepts assessment requests and explicitly states that no payment is collected. It does not pretend checkout is live.

The `paid-certification` Netlify form records an opaque `OTA-APP-...` application reference, agent version, tier, competency and contact details. A configured Payment Link receives that reference as `client_reference_id`, allowing the proctor to reconcile the application with Stripe. Application fields are untrusted intake: check the actual Stripe product, amount, currency, successful payment and customer against the application. A form's `payment-state` is never proof of receipt.

The return page does not parse session IDs or `paid=true` into a payment assertion. At launch the proctor verifies receipt in Stripe before scheduling. No automatic fulfillment, badge issuance or financial transfers exist in this client-only flow. If fulfillment is automated later, verify Stripe's signed webhook and retrieve the authoritative Checkout Session; handle asynchronous payment failure, refunds and duplicates.

## Connect the three Stripe Payment Links

Use a new direct-payment Stripe account for OpenTakeoff Academy under Michael's Stripe login. Leave the existing GitHub Sponsors connection intact. Michael completes password, legal business, bank and identity verification directly in Stripe.

Create three **one-time** products, each quantity 1 with customer-adjustable quantities disabled:

- `OpenTakeoff Academy — Apprentice human-proctored assessment` — USD 100.
- `OpenTakeoff Academy — Journeyman human-proctored assessment` — USD 200.
- `OpenTakeoff Academy — Master human-proctored assessment` — USD 300.

Product description: human-proctored takeoff assessment on real construction drawings for the selected tier. A displayable Academy badge is issued after a passing assessment. Payment does not guarantee a passing result or bounty work. Session scheduling is coordinated by the Academy.

Michael selected non-refundable paid assessments, except where required by law. Before opening sales, confirm assessment scope, session availability and retest terms and reflect the agreed terms in checkout. Configure customer receipts and accurate business identity. Redirect to `https://union.kentucky-ai.com/assessment-status.html` after payment. That page intentionally does not assert payment success.

Set the resulting live `https://buy.stripe.com/...` links with:

```sh
node scripts/set-certification-payment-link.mjs apprentice 'https://buy.stripe.com/ACTUAL_APPRENTICE_LINK'
node scripts/set-certification-payment-link.mjs journeyman 'https://buy.stripe.com/ACTUAL_JOURNEYMAN_LINK'
node scripts/set-certification-payment-link.mjs master 'https://buy.stripe.com/ACTUAL_MASTER_LINK'
npm run test:commerce
```

The example paths above are placeholders, not working payment URLs. Never configure them literally. Review the real Stripe-hosted page for each link to verify the product, exact price, USD currency and one-time charge before publishing. The helper rejects test links in live configuration and strips arbitrary query parameters.

## Bounties: Stripe Connect selected; funding is not live

The public board remains unfunded. Proposals now capture minimum credential, reward, deadline and acceptance criteria. No public browser route can create, release, refund or redirect bounty funds.

Stripe Connect supports collecting a customer payment and making a later transfer to an onboarded connected account. It explicitly does **not** offer legal escrow. Michael selected Stripe Connect with release after customer acceptance. Use accurate “funded bounty / payment released after acceptance” language. Never advertise Stripe-held funds as escrow. Separate charges and transfers require the platform to account for Stripe fees, refunds and chargebacks and maintain enough funds for outstanding obligations. Model agent owners as verified payees; an AI agent itself is not the bank-account owner.

A licensed escrow provider is a different integration. Escrow.com's milestone product supports services and buyer acceptance, but its API documentation says an inspection deadline can trigger automatic acceptance. That is not equivalent to Michael's strict customer-acceptance requirement. Do not enable it without resolving inspection, nonresponse, cancellation and dispute rules.

For either provider, implementation must establish authenticated customers, verified agent owners, authoritative credential verification, an auditable server-side transaction record, confirmed funding, controlled claim assignment, delivery evidence and authenticated customer acceptance. A client-side tier comparison is display logic only; it is not permission to claim work or receive funds.

Required lifecycle: proposed → agreed → provider-confirmed funding → assigned to qualified owner → submitted → customer inspection → accepted → release requested → provider-confirmed release. Cancellation, revision and dispute states must prevent release until resolved. Return URLs, customer-supplied amount fields, upload completion and unsigned notifications cannot advance funding or payout state.

## Primary sources checked October 3, 2026

- Stripe account separation: https://support.stripe.com/questions/security-permissions-and-access-levels-when-connecting-your-stripe-account-to-a-third-party-platform?locale=en-GB
- Payment Links: https://docs.stripe.com/payment-links
- Application reference parameters: https://docs.stripe.com/payment-links/url-parameters
- Post-payment handling: https://docs.stripe.com/payment-links/post-payment
- Stripe does not provide escrow: https://docs.stripe.com/connect/manual-payouts
- Separate charges and transfers: https://docs.stripe.com/connect/separate-charges-and-transfers
- Escrow service milestones: https://www.escrow.com/milestones
- Escrow buyer acceptance / inspection deadline: https://www.escrow.com/api/docs/accept-transaction-items
