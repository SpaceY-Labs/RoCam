FROM node:24-slim AS build

WORKDIR /workspace

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json

RUN pnpm config set node-linker hoisted
RUN pnpm install --filter shared --filter backend

COPY shared shared
COPY backend backend

RUN pnpm --filter shared build
RUN pnpm --filter backend build

FROM node:24-slim

ENV NODE_ENV=production

WORKDIR /app

  COPY --from=build /workspace/backend/dist ./dist
  COPY --from=build /workspace/backend/package.json ./package.json
  COPY --from=build /workspace/node_modules ./node_modules
  COPY --from=build /workspace/shared/dist ./node_modules/shared/dist
  COPY --from=build /workspace/shared/package.json ./node_modules/shared/package.json

  COPY backend/scripts/start.sh /app/start.sh
  RUN chmod +x /app/start.sh


EXPOSE 8080

CMD ["/app/start.sh"]
