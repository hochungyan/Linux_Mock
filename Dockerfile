FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY . .

EXPOSE 8099
CMD ["node", "serve.js"]
