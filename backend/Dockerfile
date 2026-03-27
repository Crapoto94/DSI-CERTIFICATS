FROM node:lts-alpine

WORKDIR /app

# Install build tools for native modules (sqlite3)
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY database.sqlite ./

# Create necessary directories
RUN mkdir -p file_certif logs

EXPOSE 3001

CMD ["node", "server.js"]
