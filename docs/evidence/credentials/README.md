# Commonwealth qualification insignia — October 3, 2026

## Current refinement: photographed embroidery

Michael requested the hyper-realistic finish of the OpenTakeoff badge on kentucky-ai.com. The site now uses three original, transparent embroidered-patch renders generated with the built-in image tool: black diagonal twill, raised thread lettering, thick cream merrow edges, and physical lighting. The vector versions below are the earlier design baseline.

- [Current desktop collection](embroidered-desktop.png)
- [Current certification viewer](embroidered-certification.png)
- [Current mobile collection](embroidered-mobile.png)
- [Exact prompts, reference, and asset paths](photoreal-prompts.md)

All three WebP assets are 1254×1254 with alpha preserved; combined transfer size is approximately 1.18 MiB. Inspected their stitching, spelling, rank counts, transparency, and rendering in the page. Browser verification covered the collection, the patch selector, and tier-specific enrollment. `node --check site/credentials.js` and `git diff --check` passed. This refinement changes imagery and image references, not payment or credential issuance logic.

## Earlier vector release

The homepage retains Michael's approved concrete tower and thermal study and adds “For the Commonwealth of Construction Agents.” Apprentice, Journeyman, and Master now have original, scalable mission patches: distinct outlines, colors, orbital geometry, etched lettering, and one/two/three rank marks.

The homepage collection links to each assessment tier. Certification has an interactive patch viewer and the patches appear beside the $100/$200/$300 assessments. Enrollment displays the selected tier's patch and updates it when the tier changes. Artwork previews are labeled; this design change issues no credentials and does not enable live checkout. The owner's non-refundable assessment policy is included, except where required by law.

## Visual evidence

- [Desktop collection](collection-desktop.png)
- [Mobile collection](collection-mobile.png)
- [Certification hero and interactive viewer](certification-desktop.png)

Browser checks covered a 1200 CSS-pixel desktop viewport and a 354 CSS-pixel narrow viewport (Chrome's viewport override requested 390×844; observed content width was 354). Both had document width equal to viewport width. All three patch images loaded. Inspected badge lettering, tier differentiation, and the retained building composition.

## Behavior and regression checks

- Apprentice and Journeyman preview buttons update the displayed patch, title, and pressed state; Master is the initial selection.
- The Journeyman assessment action opens enrollment with Journeyman selected, a $200 fee, and the matching patch.
- Changing enrollment to Master updates the name, price to $300, and patch together.
- The hosted draft exposes the correct three prices and states that checkout is still being set up; no payment was submitted in this design review.
- `npm run test:commerce`: **11 passed**.
- `npm run test:lab`: **12 passed**, including real-source PDF identity and rejection of retired synthetic drawings.
- `node --check site/credentials.js` and `git diff --check`: passed.
- The three SVG files parse as valid XML. Regenerate with `node scripts/render-credential-patches.mjs`.

Initial hosted draft: https://6ac18d821f909f050b899d39--opentakeoff-academy.netlify.app/certification

Payment backend work remains in the separate `feat/academy-certification-payments` worktree. Passing the commerce and lab tests is not evidence of completed end-to-end payment testing or Stripe live activation.
