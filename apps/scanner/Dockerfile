FROM node:22-alpine AS build
WORKDIR /workspace
COPY . .
RUN npm ci --ignore-scripts
RUN npm run build --workspace @crewflow/scanner

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/scanner/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
