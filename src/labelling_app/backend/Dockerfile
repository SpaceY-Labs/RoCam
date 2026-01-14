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

FROM pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential curl gnupg git libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/sam/requirements.txt /app/sam/requirements.txt
RUN pip install --no-cache-dir -r /app/sam/requirements.txt

ARG SAM3_GIT_URL=https://github.com/facebookresearch/sam3.git
ARG SAM3_GIT_REF=main
RUN git clone --depth 1 --branch "$SAM3_GIT_REF" "$SAM3_GIT_URL" /app/sam3 \
  && pip install --no-cache-dir -e /app/sam3 \
  && rm -rf /app/sam3/.git

COPY --from=build /workspace/backend/dist ./dist
COPY --from=build /workspace/backend/package.json ./package.json
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/shared/dist ./node_modules/shared/dist
COPY --from=build /workspace/shared/package.json ./node_modules/shared/package.json

COPY backend/sam /app/sam
COPY backend/scripts/start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV SAM3_INTERNAL_PORT=9000
ENV SAM3_MODEL_PATH=/app/sam/weights/sam3.pt

EXPOSE 8080

CMD ["/app/start.sh"]
