# ── Build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Compila TypeScript (src → dist) e remove dependências de desenvolvimento.
# As migrações rodam via drizzle-orm/migrator na inicialização (sem drizzle-kit).
RUN npm run build && npm prune --omit=dev

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# package.json é necessário para o Node tratar os .js como ESM ("type": "module").
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle

# /app/data → banco SQLite (volume) · /app/uploads → arquivos enviados (volume)
RUN mkdir -p /app/uploads /app/data

EXPOSE 3001

CMD ["node", "dist/index.js"]
