FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/.data DROP_TO_NODE=true
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --ignore-scripts --include=dev --no-audit && mkdir .data && chown node:node .data
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN npm run build && npm prune --omit=dev --ignore-scripts --offline --no-audit
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--use-env-proxy", "src/server.js"]
