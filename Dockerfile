FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=13001

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY public ./public
COPY lib ./lib
COPY scripts ./scripts

RUN mkdir -p /app/logs && chown -R node:node /app

USER node

EXPOSE 13001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
