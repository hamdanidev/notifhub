# syntax=docker/dockerfile:1
# NotifHub console images: one build stage, two targets.
#   --target runner-tenant   (default, last stage)  → dist/tenant on port 80
#   --target runner-platform                        → dist/platform on port 80
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

FROM build AS build-tenant
ARG VITE_NOTIFHUB_API_URL=http://localhost:3000
ARG VITE_PLATFORM_CONSOLE_URL=
ENV VITE_NOTIFHUB_API_URL=$VITE_NOTIFHUB_API_URL
ENV VITE_PLATFORM_CONSOLE_URL=$VITE_PLATFORM_CONSOLE_URL
RUN npm --prefix console run build:tenant

FROM build AS build-platform
ARG VITE_NOTIFHUB_API_URL=http://localhost:3000
ENV VITE_NOTIFHUB_API_URL=$VITE_NOTIFHUB_API_URL
RUN npm --prefix console run build:platform

FROM nginx:1.27-alpine AS runner-platform
COPY console/nginx/platform.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build-platform /app/console/dist/platform /usr/share/nginx/html
EXPOSE 80

# Keep runner-tenant last so `docker build -f console/Dockerfile .` keeps building the tenant image.
FROM nginx:1.27-alpine AS runner-tenant
COPY console/nginx/tenant.conf.template /etc/nginx/templates/default.conf.template
COPY console/nginx/check-platform-url.sh /docker-entrypoint.d/40-check-platform-url.sh
RUN chmod +x /docker-entrypoint.d/40-check-platform-url.sh
COPY --from=build-tenant /app/console/dist/tenant /usr/share/nginx/html
EXPOSE 80
