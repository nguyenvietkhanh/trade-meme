FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 TRADING_MODE=paper PAPER_MODE=true MODEL_TRADING_ENABLED=false
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node src ./src
COPY --chown=node:node paper-week ./paper-week
RUN mkdir .paper-week && chown node:node .paper-week
EXPOSE 3100
CMD ["node", "--use-env-proxy", "paper-week/bootstrap.js"]
