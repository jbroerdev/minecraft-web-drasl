FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.25.0
WORKDIR /app/launcher
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server.mjs online-bridge.mjs index.html ./
ADD client.tar.gz /app/web-dist/
ADD gateway.tar.gz /app/deploy/
COPY entrypoint.sh /app/deploy/entrypoint.sh
RUN ln -s /data/launcher /app/launcher/.runtime && sed -i 's/\r$//' /app/deploy/entrypoint.sh
WORKDIR /app
EXPOSE 8790
ENTRYPOINT ["bash", "/app/deploy/entrypoint.sh"]
