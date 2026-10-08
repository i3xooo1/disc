FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build:production

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TRUST_PROXY=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && mkdir -p /data \
    && chown node:node /data /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./dist/public
USER node
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
