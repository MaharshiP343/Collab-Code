# ─── Stage 1: Build React client ───────────────────────────────────────────────
FROM node:20-alpine AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm install

COPY client/ ./
RUN npm run build

# ─── Stage 2: Production server ────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY --from=client-builder /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.js"]
