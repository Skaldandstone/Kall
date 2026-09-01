FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS base

# Alpine's LTS Node package links to the distribution OpenSSL libraries. Pin
# the image and every security-relevant package so Node cannot silently fall
# back to the vulnerable bundled or 3.5.7-r0 library paths.
RUN set -eu; \
    apk add --no-cache \
        nodejs=24.18.1-r0 \
        npm=11.12.1-r0 \
        libssl3=3.5.8-r0 \
        libcrypto3=3.5.8-r0; \
    test "$(node -p process.versions.node)" = "24.18.1"; \
    test "$(npm --version)" = "11.12.1"; \
    test "$(node -p process.versions.openssl)" = "3.5.8"; \
    ! apk info --exists "libssl3=3.5.7-r0"; \
    ! apk info --exists "libcrypto3=3.5.7-r0"; \
    apk info --exists "libssl3=3.5.8-r0"; \
    apk info --exists "libcrypto3=3.5.8-r0"; \
    apk info --who-owns /usr/bin/node | grep -F "nodejs-24.18.1-r0"; \
    ldd /usr/bin/node | grep -F "/usr/lib/libssl.so.3"; \
    ldd /usr/bin/node | grep -F "/usr/lib/libcrypto.so.3"; \
    ! command -v curl >/dev/null 2>&1

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# next build inlines NEXT_PUBLIC_* values into the client bundle, and it runs
# *here*, inside the image build -- so setting it only on a runtime task is not
# enough; it has to be passed through as a build argument.
# Without it @clerk/nextjs fails the build outright with
# "Missing publishableKey".
#
# Safe as a build arg precisely because a publishable key is public: it only
# names the Clerk instance. CLERK_SECRET_KEY must never be passed this way --
# build args are recorded in the image history. The proxy reads it at runtime
# from the service environment instead.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["npm", "run", "start"]
