FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .
RUN mkdir -p /app/public_uploads /app/private_uploads && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "server.js"]
