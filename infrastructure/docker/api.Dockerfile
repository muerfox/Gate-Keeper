# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
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
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]
