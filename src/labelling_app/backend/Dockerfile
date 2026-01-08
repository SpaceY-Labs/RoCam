# Build context must be the labelling_app root (it needs backend/ and shared/).
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/tsconfig.json ./backend/
COPY shared/package.json shared/tsconfig.json ./shared/

RUN pnpm install --filter backend... --filter shared... --frozen-lockfile

FROM deps AS build
COPY backend ./backend
COPY shared ./shared
RUN pnpm --filter shared build
RUN pnpm --filter backend build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
COPY shared/package.json ./shared/
RUN pnpm install --filter backend... --filter shared... --prod --frozen-lockfile

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/shared/dist ./shared/dist

EXPOSE 8080
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
