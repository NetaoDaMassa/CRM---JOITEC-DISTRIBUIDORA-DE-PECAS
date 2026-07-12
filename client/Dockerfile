# ── Build ────────────────────────────────────────────────────────────────────
# Contexto de build = raiz do repositório (o frontend importa os TIPOS do server
# via "@server", então o server/src precisa estar presente na hora do build).
FROM node:20-alpine AS build

WORKDIR /app

# Instala as dependências do workspace (raiz + client + server).
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm install

# Fontes necessárias para compilar o client (server só é usado para tipagem).
COPY client ./client
COPY server ./server

# Em produção o nginx faz proxy de /trpc, /upload e /uploads para o backend na
# mesma origem, então o client usa caminhos relativos (nada de env necessário).
RUN npm run build -w client

# ── Serve ────────────────────────────────────────────────────────────────────
FROM nginx:alpine

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html

EXPOSE 80
