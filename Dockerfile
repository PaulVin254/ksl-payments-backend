# Multi-stage production build for KSL Payments Backend
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (for layer caching)
COPY package*.json ./
RUN npm ci

# Copy TypeScript source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run compile

# Production runner image
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled JavaScript output
COPY --from=builder /app/dist ./dist

EXPOSE 8080

CMD ["node", "dist/index.js"]
