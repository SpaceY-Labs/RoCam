FROM node:20-slim AS build

WORKDIR /workspace

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json

RUN pnpm install --filter shared --filter backend

COPY shared shared
COPY backend backend

RUN pnpm --filter shared build
RUN pnpm --filter backend build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /workspace/backend/dist ./dist
COPY --from=build /workspace/backend/package.json ./package.json
COPY --from=build /workspace/backend/node_modules ./node_modules
COPY --from=build /workspace/shared/dist ./node_modules/shared/dist
COPY --from=build /workspace/shared/package.json ./node_modules/shared/package.json

EXPOSE 8080

CMD ["node", "dist/index.js"]
