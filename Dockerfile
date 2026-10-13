FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data/tmp && chown -R node:node /app
USER node
EXPOSE 4000 5100
CMD ["node", "src/server.js"]
