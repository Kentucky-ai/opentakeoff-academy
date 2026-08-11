# Reference container entrant

The smallest thing that satisfies the [sealed-container contract](../../docs/CONTAINER-RUNNER.md): a ~90-line adapter ([`agent.mjs`](./agent.mjs)) that drives the [Environment API](../../docs/ENVIRONMENT-API.md) lifecycle — `GET /v1/session` → `POST /v1/tools/*` → `POST /v1/task/done` → exit — with a scripted brain good enough to pass the public practice suite. Swap the brain (`decideAndMeasure`) for your model/parser; keep the loop.

Try the full proctored flow locally:

```bash
docker build -t ota-example-entrant .
cd ../..
node src/cli.js proctor --track div9 --suite practice --image ota-example-entrant --out ./runs/example.bundle.json
node src/cli.js score ./runs/example.bundle.json --track div9 --suite practice
```

Or run the adapter bare against a served session (no Docker):

```bash
node src/cli.js serve --track div9 --suite practice --out ./runs/bare.bundle.json
# in another shell, with the printed URL + token:
ACADEMY_ENV_URL=http://127.0.0.1:PORT/v1 ACADEMY_SESSION_TOKEN=TOKEN node examples/container/agent.mjs
```
