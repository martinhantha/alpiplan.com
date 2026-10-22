FROM node:24.22.1-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY src ./src
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
