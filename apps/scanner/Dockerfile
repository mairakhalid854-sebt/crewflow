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
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||'8080')+'/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
