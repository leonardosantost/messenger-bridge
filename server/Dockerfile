FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 compila um addon nativo; se não houver binário pré-compilado
# para a plataforma da imagem, precisa de toolchain de build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]
