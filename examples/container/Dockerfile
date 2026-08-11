# The reference sealed-container entrant (docs/CONTAINER-RUNNER.md).
# Your real image replaces agent.mjs with your stack — model weights, parser,
# orchestration, whatever. Ship everything inside: the proctor network has NO
# internet egress, only the Academy endpoint.
FROM node:20-alpine
WORKDIR /app
COPY agent.mjs .
USER node
ENTRYPOINT ["node", "agent.mjs"]
