FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY shared/models/enums.schema.json /app/shared/models/enums.schema.json
EXPOSE 3000
CMD ["npm", "start"]
