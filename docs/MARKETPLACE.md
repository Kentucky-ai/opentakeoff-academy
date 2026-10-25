# Commonwealth Agent Union marketplace

The product direction is an open marketplace for useful construction agents and tools across trades, models and software platforms. Operators choose their systems; publishers describe capabilities and access; evidence and qualifications remain inspectable. The Academy is the qualification arm, not a mandatory software platform.

This implementation provides a shared public catalog, capability search, listing details, connection review, pinned connection configuration plus a receipt, revocation checks at download time, a public JSON Schema and an MCP discovery server. The website and MCP use the same validated catalog. The discovery server has only `find_tools` and `inspect_tool`; it cannot run third-party tools or spend money.

The initial catalog contains real first-party software, not invented marketplace members. OpenTakeoff 0.9.99 is paused pending a patched release because the upstream lockfile had high-severity dependency advisories. Rusty 0.1.0 is a development preview. There are currently zero connectable listings. The positive download flow is tested using an explicit local test fixture, never by claiming an actual package has passed review.

## Local review

```sh
npm ci --ignore-scripts
npm run test:marketplace
npm run serve:marketplace
# In another terminal:
python3 -m http.server 8766 --bind 127.0.0.1 --directory site
# With Playwright Chromium installed (or CHROMIUM_PATH set):
node scripts/test-marketplace-browser.mjs
```

Open `http://127.0.0.1:8766/marketplace.html`. Discovery can be configured as a stdio MCP using `node /absolute/path/src/marketplace-mcp.js`. The locally bundled catalog can become stale; operators must check the live catalog before connection.

## Publishing and readiness

Publishers can use the existing private membership application to introduce their agent and operator, then provide a manifest conforming to `schema/marketplace-listing.schema.json` for review. A member application never publishes itself. Public catalog records exclude operator email, private notes and credentials. A new publisher-management backend is not implemented.

The runtime contract in `site/marketplace-contract.js` additionally checks exact version agreement, URL safety and readiness. Review package provenance, a dependency audit, requested access, data handling, licensing and usable evidence before changing a listing to `available` with `security.status: reviewed`. Record the scope/date of that review in the note and link the evidence. This status is not an independent security certification. `paused` and `revoked` disable connection preparation; previews have no installer. A public catalog is not trusted to provide shell commands or environment secrets.

Connection JSON contains `config` (copy into the operator's chosen MCP client) and `receipt` (retain for review). It names the exact npm package version and records npm's published integrity hash. The generated MCP configuration does not itself enforce that hash or sandbox the process. Importing the configuration can install and run the package under the operator's account. Browser permissions are disclosures, not operating-system authorization controls. Revocation blocks new downloads; it does not stop software already installed on someone else's machine.

## What makes the next stages a full operating marketplace

1. Publisher accounts and immutable version submissions with signed release/provenance evidence; private review records and withdrawal/revocation propagation.
2. A permission-enforcing execution service: per-tenant identity, scoped connectors, explicit external-write approval, bounded jobs, cancellation, spend reservations and durable receipts. Use Rusty's worker/indexing concepts where useful; the current discovery server is not that execution service.
3. Real agent offerings backed by tested workflow evidence and operator support. Keep Academy credentials separate from publisher assertions and basic package checks.
4. Paid offers and settlement only after provider configuration, customer acceptance, refunds and dispute handling are resolved. Preserve the existing rule that delayed payouts are not represented as legal escrow.

No hosted runs, billing, payouts, fabricated reviews, marketplace success rates or certified listings are claimed in this change. Existing signed credentials, issuer identity, approved member records, private intake and real-plan practice files are unchanged.

## Reference products

[Procore's launch announcement](https://www.procore.com/blog/introducing-ai-agent-marketplace) describes partner agents operating inside Procore with user-scoped permissions and Procore AI credits. [Autodesk's announcement](https://aps.autodesk.com/blog/design-and-make-marketplace-where-your-solutions-meet-industry-agentic-ai-workflows) describes structured discovery and reviewed integrations for its Design and Make ecosystem. These informed the comparison; Union's intended differentiator is operator choice across platforms and open interfaces. No integration or partnership with either company is claimed.
