FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /app/database \
    && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "server.js"]