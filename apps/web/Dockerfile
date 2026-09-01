FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base

# ECR found OpenSSL 3.5.7-r0 in the reviewed base. Keep builds blocked until
# Alpine publishes a successor and the exact installed version is reviewed.
ARG ALPINE_OPENSSL_APPROVED_VERSION
RUN set -eu; \
    ssl_version="$(apk info -v libssl3 | sed 's/^libssl3-//')"; \
    crypto_version="$(apk info -v libcrypto3 | sed 's/^libcrypto3-//')"; \
    test -n "${ALPINE_OPENSSL_APPROVED_VERSION}"; \
    test "${ssl_version}" != "3.5.7-r0"; \
    test "${crypto_version}" != "3.5.7-r0"; \
    test "${ssl_version}" = "${ALPINE_OPENSSL_APPROVED_VERSION}"; \
    test "${crypto_version}" = "${ALPINE_OPENSSL_APPROVED_VERSION}"

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
