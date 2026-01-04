FROM node:20-alpine

WORKDIR /app

# Install dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the TypeScript project
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/index.js"]
