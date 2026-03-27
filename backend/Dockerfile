FROM node:lts-alpine

WORKDIR /app

# Install build tools for native modules (sqlite3)
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY file_certif ./file_certif

# Create necessary directories
RUN mkdir -p logs

EXPOSE 3001

CMD ["node", "server.js"]
