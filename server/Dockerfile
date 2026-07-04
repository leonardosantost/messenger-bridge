FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 compila um addon nativo; se não houver binário pré-compilado
# para a plataforma da imagem, precisa de toolchain de build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Build context = raiz do repositório (monorepo); por isso os caminhos abaixo
# começam com "server/". Se seu builder usar "server" como contexto (não a
# raiz do repo), troque para os caminhos sem o prefixo "server/".
COPY server/package*.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]
