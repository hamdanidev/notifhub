# syntax=docker/dockerfile:1
# NotifHub tenant console: Vite build + nginx static hosting.
# Build context is the repository root because the console depends on @notifhub/js.

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/js-sdk/package.json ./packages/js-sdk/package.json
COPY packages/react/package.json ./packages/react/package.json
RUN npm ci

COPY packages/js-sdk ./packages/js-sdk
RUN npm run sdk:build

COPY console/package.json console/package-lock.json ./console/
RUN npm --prefix console ci

COPY console ./console

ARG VITE_NOTIFHUB_API_URL=http://localhost:3000
ENV VITE_NOTIFHUB_API_URL=$VITE_NOTIFHUB_API_URL
RUN npm run console:build

FROM nginx:1.27-alpine AS runner
COPY console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/console/dist /usr/share/nginx/html
EXPOSE 80
