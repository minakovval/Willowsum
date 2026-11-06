# One image for all backend roles (ARC-02 FR 1): the role is chosen by the start command,
#   docker run <image> --role api|worker|scheduler
# Build from the repository root: docker build -f apps/api/Dockerfile .
# Node 22 runs the TypeScript sources directly (type stripping); there is no build step.
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/domain-kernel/package.json packages/domain-kernel/
# Workspace manifest only: the synthetic-data tool is a dev dependency and is not installed (--prod).
COPY tools/synthetic/package.json tools/synthetic/
RUN pnpm install --frozen-lockfile --prod --filter "@willowsum/api..."

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/domain-kernel/node_modules ./packages/domain-kernel/node_modules
COPY packages/domain-kernel/package.json packages/domain-kernel/
COPY packages/domain-kernel/src packages/domain-kernel/src
COPY apps/api/package.json apps/api/module-rules.json apps/api/
COPY apps/api/src apps/api/src
WORKDIR /app/apps/api
# Not root; no secrets in the image — configuration comes from the environment at start (ARC-02 FR 3).
USER node
EXPOSE 8080
ENTRYPOINT ["node", "src/main.ts"]
