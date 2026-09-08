# syntax=docker/dockerfile:1
#
# Builds the standalone test-login smoke-test app (docker-compose.test.yml).
# Unlike api.Dockerfile/dashboard.Dockerfile this image keeps the whole repo
# and dev tooling (prisma CLI, tsx) at runtime — its entrypoint applies the
# DB schema and seeds a throwaway test site on every start. See
# docs/TESTING.md.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/test-login/package.json apps/test-login/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/captcha-server/package.json packages/captcha-server/package.json
COPY packages/captcha-client/package.json packages/captcha-client/package.json
RUN npm install
COPY . .
RUN npm run build --workspace=@gatekeeper/shared \
  && npm run build --workspace=@gatekeeper/crypto \
  && npm run build --workspace=@gatekeeper/captcha-server \
  && npm run build --workspace=@gatekeeper/captcha-client

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=development
COPY --from=build /repo /repo
RUN chmod +x apps/test-login/docker-entrypoint.sh
EXPOSE 8000
ENTRYPOINT ["apps/test-login/docker-entrypoint.sh"]
