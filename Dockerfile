# syntax=docker/dockerfile:1

# ---------- 依赖与构建 ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 静态页面服务（web） ----------
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --retries=20 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

# ---------- 一次性验收服务（verify） ----------
# Playwright 官方镜像已预装 Chromium 及系统依赖；该阶段独立 npm ci
# （Debian/glibc，不能复用 Alpine 阶段的 node_modules）。
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS verify
WORKDIR /app
# 镜像已预装与 package.json 同版本（1.63.0）的 Chromium，无需 postinstall 再下载
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# 等待 web 就绪后执行 E2E；容器随测试结束退出（exit code 即验收结论）。
CMD ["node", "scripts/wait-for-web.mjs", "npx", "playwright", "test"]
