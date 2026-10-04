# Original Academy brand artwork

These assets are decorative brand artwork. They are not source construction drawings or measurement evidence.

- `concrete-tower.jpg`: original image generated for this site on October 3, 2026. Michael approved retaining this building. Prompt: monochrome documentary-style unfinished concrete high-rise with exposed slabs and a crane, portrait 2:3, dark charcoal background, no text, logos, grids, or people; architectural detail with deep shadows and silvery highlights.
- `concrete-tower-thermal.jpg`: image-generation edit of that original building, preserving the geometry and composition. Prompt: companion false-color thermal-camera-inspired treatment, dark navy shadows, cool blue/cyan structure, orange and pale cream warm surfaces, fine texture, no text, labels, grids, or claims of measured temperature. Decorative thermal illustration, not a real thermal survey.
- `academy-patch.svg`: original code-authored program insignia: stitched shield, geometric A, orbital line, Division 09 and Kentucky lettering. Not an issued certification badge.
- `patch-apprentice.svg`, `patch-journeyman.svg`, `patch-master.svg`: original vector qualification insignia authored October 3, 2026. Circular lime, octagonal ice-blue, and thermal-orange shield variants share the Academy's architectural A, measurement rings, stitched borders, and one/two/three rank marks. The owner's line, “For the Commonwealth of Construction Agents,” establishes the collection's identity. Regenerate with `node scripts/render-credential-patches.mjs`. Public specimens preview the designs; they do not certify an agent or replace the signed credential record.

Layout inspiration: Michael's supplied poster reference and Kyle Anthony Miller's thermal reconnaissance design post at https://x.com/kyleanthony/status/2096936475820450291. No imagery or logos from that post are reproduced in these assets.

Also reviewed his October 3 technical identity study: https://x.com/kyleanthony/status/2106390933793124415/photo/1. Technical labels, strong typography, and industrial insignia inform the visual direction; the Academy assets and layout are original.

## Photorealistic embroidery refinement

At Michael's direction, the website now uses `patch-apprentice-embroidered.webp`, `patch-journeyman-embroidered.webp`, and `patch-master-embroidered.webp` in place of the flat SVG specimens. These are original image-generation renderings of physical embroidery, with black twill, raised satin lettering, cream stitched edging, directional light, and transparent backgrounds. They were generated using the built-in image tool. The older SVGs remain design source references.

Material reference: the owner's existing OpenTakeoff patch at https://kentucky-ai.com/media/roundel-720.jpg, as displayed at https://kentucky-ai.com/#request. The Academy's original tier geometry, names, Commonwealth identity, and colors are retained. These renders are brand artwork; they are not photographs of manufactured patches or evidence that a credential has been earned.

The selected 1254×1254 PNG originals are retained locally in `output/imagegen/credential-patches/`. The site uses alpha-preserving WebP copies (quality 90, alpha quality 100), totaling about 1.18 MiB across all three assets. Exact prompts and conversion details: [photoreal-prompts.md](../../docs/evidence/credentials/photoreal-prompts.md).
