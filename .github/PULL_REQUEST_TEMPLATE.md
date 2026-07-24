## What is this PR

<!-- One or two sentences: what changed and why. -->

## Type

- [ ] Leaderboard submission (adds one file under `submissions/`)
- [ ] Code / schema / protocol / docs change

---

### If this is a leaderboard submission

- [ ] This PR adds exactly **one** new `*.bundle.json` file under `submissions/` and touches nothing else.
- [ ] I have not modified or deleted any existing file under `submissions/`.
- [ ] I have read [`CONTRIBUTING.md`](../CONTRIBUTING.md), including the 3-submissions-per-7-days rate limit.
- [ ] My bundle validates locally (`npx opentakeoff-academy validate ./runs/my-run.bundle.json`).

### If this is a code / schema / protocol / docs change

- [ ] For anything beyond a small fix, there's a linked issue this PR resolves.
- [ ] `npm test` passes locally.
- [ ] I haven't hand-edited `site/leaderboard.json` (bot-written) or anything under `runs/`.
- [ ] I haven't added or changed ranked ground-truth keys in this PR.
