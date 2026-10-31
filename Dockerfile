FROM oven/bun:1.4.4-alpine AS base
WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy application sources
COPY contracts ./contracts
COPY server ./server
COPY src ./src
COPY tsconfig.json ./

ENV PORT=3001
EXPOSE 3001

CMD ["bun", "run", "./server/index.ts"]
