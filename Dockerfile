# insider-th.me — production image (Coolify / any Docker host)
# ห้องเกมอยู่ในหน่วยความจำ: รันได้ 1 container เท่านั้น (ห้ามตั้ง replicas > 1)
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    GAME_DATA_DIR=/data

WORKDIR /app

# Every production build, including a manual Coolify Deploy, must use an exact green CI commit.
ARG SOURCE_COMMIT
COPY ci/verify-release.cjs /tmp/verify-release.cjs
RUN SOURCE_COMMIT="$SOURCE_COMMIT" node /tmp/verify-release.cjs && rm /tmp/verify-release.cjs

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Coolify ส่ง SOURCE_COMMIT มาเป็น build arg → ใช้เป็นเลข build (cache-busting ไฟล์ static)
ENV SOURCE_COMMIT=${SOURCE_COMMIT}

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/ping" >/dev/null 2>&1 || exit 1

# node เป็น PID 1 โดยตรง → ได้ SIGTERM แล้วเซฟห้อง/กระเป๋า/log ก่อนปิด (app.js flushAndExit)
CMD ["node", "app.js"]
