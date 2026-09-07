# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install
COPY . .
RUN npm run build --workspace=@gatekeeper/shared && npm run build --workspace=@gatekeeper/dashboard

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/dashboard/dist /usr/share/nginx/html
COPY infrastructure/docker/dashboard.nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
