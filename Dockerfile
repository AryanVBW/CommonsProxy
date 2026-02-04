# Multi-stage build for CommonsProxy
# Stage 1: Builder - Install dependencies and build CSS
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for CSS build)
RUN npm ci

# Copy source code
COPY . .

# Build CSS
RUN npm run build:css

# Stage 2: Production - Minimal runtime image
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy built assets and source from builder
COPY --from=builder /app/public/css/style.css /app/public/css/style.css
COPY --from=builder /app/src ./src
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/public ./public

# Create data directory for persistent storage
RUN mkdir -p /app/data/.config/commons-proxy && \
    chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Set environment variables
ENV NODE_ENV=production \
    PORT=8080 \
    CONFIG_PATH=/app/data/.config/commons-proxy

# Start server
CMD ["node", "src/index.js"]
