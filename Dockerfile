# realSocial server: WhatsApp webhook and admin review page, for hosts such as Railway.
FROM node:26-slim

WORKDIR /app

# Listen on all addresses inside the container; the host gives the port in PORT.
# The database and uploaded documents live on a persistent volume mounted at /data.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DB_PATH=/data/app.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY catalog ./catalog
COPY src ./src

CMD ["node", "--import", "tsx", "src/server.ts"]
