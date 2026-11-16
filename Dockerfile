# syntax=docker/dockerfile:1
# NotifHub backend image.
#   build   -> has dev dependencies, used for prisma generate + nest build + migrations
#   prod    -> build with dev dependencies pruned (runtime node_modules)
#   runner  -> minimal runtime image, non-root
#   migrator-> one-shot `prisma migrate deploy` service
#
# openssl is installed in the base stage so `prisma generate` detects the same libssl as the
# runtime image (bookworm ships OpenSSL 3.x); otherwise Prisma picks the legacy 1.1.x engine.

FROM node:24-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate \
 && npm run build

FROM build AS migrator
# Keeps the Prisma CLI (a dev dependency) so migrations can run as a separate service.
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS prod-deps
RUN npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/dist ./dist
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=prod-deps /app/package.json ./package.json

ENV PORT=3000
ENV TEMPLATE_IMAGE_DIR=/app/var/template-images
RUN mkdir -p "$TEMPLATE_IMAGE_DIR" && chown -R node:node /app/var
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
