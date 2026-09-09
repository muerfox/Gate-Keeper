# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
# Alpine ships OpenSSL 3 but not the `openssl` CLI Prisma uses to detect
# it — without this, `prisma generate` can't tell and silently defaults
# to bundling an engine linked against OpenSSL 1.1, which then fails to
# load (Alpine hasn't shipped that version in years). See docs/TESTING.md.
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/challenges/package.json packages/challenges/package.json
COPY packages/risk-engine/package.json packages/risk-engine/package.json
COPY packages/rate-limit/package.json packages/rate-limit/package.json
RUN npm install
COPY . .
RUN npm run build --workspace=@gatekeeper/shared \
  && npm run build --workspace=@gatekeeper/crypto \
  && npm run build --workspace=@gatekeeper/challenges \
  && npm run build --workspace=@gatekeeper/risk-engine \
  && npm run build --workspace=@gatekeeper/rate-limit \
  && npm run build --workspace=@gatekeeper/api

FROM node:20-alpine AS runtime
# Same reason as the build stage: Prisma's runtime engine loader also
# needs the `openssl` CLI to correctly detect OpenSSL 3, or it defaults
# to the wrong (1.1) engine and crashes on startup.
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]
