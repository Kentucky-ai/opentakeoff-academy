# Construction’s Last Exam — source review

Checked October 25, 2026. CLE belongs to **Togal.AI**, not Procore. This is a source review, not an independent benchmark run.

## What is actually public

- [Overview](https://cle.togal.ai/overview.html): 33 geometry tasks—12 area, 12 counting and nine linear. It labels Togal’s reference as human-assisted, with up to 30 seconds of intervention.
- [Prompt explorer](https://cle.togal.ai/answers.html) and its [data file](https://cle.togal.ai/answers-data/data.js): full task prompts, expected-result summaries, ground-truth/prediction image links and per-model scores. The inspected snapshot identifies October 13 as its generation date, lists 25 models and contains 667 answer records. Only 33 records have a non-null `prediction` field, all under Togal’s entry; none has verifier stdout. The UI’s full-response description should not be read as evidence that every raw model response is present.
- The overview links a Google Drive bundle for PDFs, Togal predictions and model runs. Those archives were not downloaded or independently reproduced here.
- The linked [GitHub repository](https://github.com/Togal-ai-Team/tle-bench) returned 404 through both the public page and authenticated API. Scorer source, runner configuration and reuse license could not be verified. Public accessibility alone does not establish redistribution rights.

## What the prompts teach us

The inspected balcony, tagged-fixture and wall-centerline tasks specify inclusion/exclusion rules, geometry conventions, coordinate frames, source restrictions and strict output formats. Coordinates use the full PDF page on a 0–1000 grid with a top-left origin. Areas return closed polygon rings; fixtures return individual points; walls return polylines. A total quantity alone is not the requested answer. The wall task also specifies junction breakpoints and continuity through openings.

These details matter: a plausible count or total can conceal misplaced objects or wrong boundaries. The published answer records distinguish precision, recall, false positives/negatives and overlap. Exact scoring thresholds and aggregation code still require the unavailable repository or another authoritative release. Do not equate a composite geometry score with the percentage of a real bid that is correct, or compare a human-assisted reference directly with an unassisted model run.

## Apply to Union, OpenTakeoff and Rusty

1. **Union:** use an original, explicit task contract and display per-task evidence, tool/model versions, assistance, errors and costs. Separate model-only, tool-assisted and human-assisted tracks. Keep qualification tied to its assessed version and scope.
2. **OpenTakeoff:** export source-linked geometry and review records, not just totals. Make boundary conventions and unresolved regions visible to the estimator.
3. **Rusty:** validate geometry and coordinate conversions deterministically; preserve source hashes and refused/unread pages. Its text index alone cannot answer these geometry tasks.

Keep public practice separate from held-out certification. Do not train on public answers and then advertise the resulting score as unseen performance. First reproduce one task from each family once drawings, scorer and license are verifiable; no paid model runs, answer-key imports or copied prompts are included in this change.

## Marketplace reference

[Procore’s app directory](https://marketplace.procore.com/apps) uses category/capability filters and publisher-attributed listings. Its [support guide](https://support.procore.com/faq/common-questions-apps-and-marketplace) assigns pricing and support to individual publishers. Union adopts the browsing, listing-detail and publisher-intake pattern while retaining open client choice. No Procore integration or partnership is claimed.
