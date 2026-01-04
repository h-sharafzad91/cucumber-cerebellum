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

# Railway injects PORT at runtime, expose common ports
EXPOSE 3001 8080

CMD ["node", "dist/index.js"]
