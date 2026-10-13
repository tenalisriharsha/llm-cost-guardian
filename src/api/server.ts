import express, { type NextFunction, type Request, type Response } from "express";
import {
  attributeBy,
  detectAnomalies,
  evaluateBudgets,
  ingestBatch,
  type AttributionDimension,
  type BudgetConfigStore,
  type BudgetPeriod,
  type EventStore,
  type RawUsageEvent,
} from "../core/index.js";
import { ApiKeyRegistry, type AuthContext } from "./apiKeys.js";
import { noopLogger, type Logger } from "./logging.js";
import { Metrics } from "./metrics.js";
import { FixedWindowRateLimiter } from "./rateLimit.js";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
  }
}

export interface ServerDeps {
  eventStore: EventStore;
  budgetStore: BudgetConfigStore;
  apiKeys: ApiKeyRegistry;
  rateLimiter?: FixedWindowRateLimiter;
  logger?: Logger;
  metrics?: Metrics;
}

const ATTRIBUTION_DIMENSIONS: AttributionDimension[] = ["team", "apiKeyId", "model", "provider"];

/** An `admin`-role key can act on behalf of any team via `?team=<name>`; a `team`-role key is
 * always confined to its own team regardless of what (if anything) it passes. */
function resolveTeam(req: Request): string {
  const auth = req.auth!;
  const requested = req.query.team;
  if (auth.role === "admin" && typeof requested === "string" && requested.length > 0) {
    return requested;
  }
  return auth.team;
}

/** Thin HTTP wrapper around the core domain: every route is auth'd by API key, scoped to that key's team, and delegates straight to ingestBatch/attributeBy/evaluateBudgets. */
export function createServer(deps: ServerDeps) {
  const {
    eventStore,
    budgetStore,
    apiKeys,
    rateLimiter = new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 120 }),
    logger = noopLogger,
    metrics = new Metrics(),
  } = deps;

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Structured request log + metrics for every request, auth'd or not, logged on `finish` so the
  // real status code (set by whichever handler/middleware responds) is always what's recorded.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      metrics.recordRequest(res.statusCode);
      logger.info("http_request", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        apiKeyId: req.auth?.apiKeyId,
        team: req.auth?.team,
        role: req.auth?.role,
      });
    });
    next();
  });

  // Permissive CORS: every route below is already gated by a bearer API key, so allowing any
  // browser origin (e.g. the dashboard's own dev server port) to call in costs nothing extra.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Unauthenticated, like /health: a Prometheus-style scrape target is expected to sit behind
  // network policy (a cluster-internal scrape path), not behind the per-team bearer auth below.
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(metrics.toPrometheus());
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    const auth = apiKeys.authenticate(key);
    if (!auth) {
      metrics.recordAuthFailure();
      res.status(401).json({ error: "missing or invalid API key" });
      return;
    }
    req.auth = auth;
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const { allowed, retryAfterMs } = rateLimiter.tryConsume(req.auth!.apiKeyId);
    if (!allowed) {
      metrics.recordRateLimitRejection();
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      res.status(429).json({ error: "rate limit exceeded" });
      return;
    }
    next();
  });

  app.get("/whoami", (req: Request, res: Response) => {
    res.json(req.auth!);
  });

  app.post("/events", (req: Request, res: Response) => {
    const auth = req.auth!;
    if (!Array.isArray(req.body)) {
      res.status(400).json({ error: "request body must be a JSON array of events" });
      return;
    }
    const rawEvents = req.body as RawUsageEvent[];

    const scoped: RawUsageEvent[] = [];
    const scopeRejected: Array<{ raw: RawUsageEvent; error: string }> = [];
    for (const raw of rawEvents) {
      if (auth.role === "admin") {
        // An admin key can ingest on behalf of any team; it just fills in its own identity
        // where the caller didn't specify one, instead of enforcing a match against it.
        scoped.push({ ...raw, team: raw.team ?? auth.team, apiKeyId: raw.apiKeyId ?? auth.apiKeyId });
        continue;
      }
      if (raw.team !== undefined && raw.team !== auth.team) {
        scopeRejected.push({ raw, error: `team "${raw.team}" does not match authenticated team "${auth.team}"` });
        continue;
      }
      if (raw.apiKeyId !== undefined && raw.apiKeyId !== auth.apiKeyId) {
        scopeRejected.push({
          raw,
          error: `apiKeyId "${raw.apiKeyId}" does not match authenticated key "${auth.apiKeyId}"`,
        });
        continue;
      }
      scoped.push({ ...raw, team: auth.team, apiKeyId: auth.apiKeyId });
    }

    const { accepted, rejected } = ingestBatch(scoped);
    const stored = eventStore.appendMany(accepted);

    const countsByTeam = new Map<string, number>();
    for (const event of stored) {
      countsByTeam.set(event.team, (countsByTeam.get(event.team) ?? 0) + 1);
    }
    for (const [team, count] of countsByTeam) metrics.recordEventsIngested(team, count);

    res.status(202).json({
      accepted: stored.length,
      duplicates: accepted.length - stored.length,
      rejected: rejected.length + scopeRejected.length,
      errors: [...scopeRejected, ...rejected].map(({ raw, error }) => ({
        timestamp: raw.timestamp,
        error,
      })),
    });
  });

  app.get("/report", (req: Request, res: Response) => {
    const team = resolveTeam(req);
    const by = (req.query.by as AttributionDimension) ?? "model";
    if (!ATTRIBUTION_DIMENSIONS.includes(by)) {
      res.status(400).json({ error: `invalid dimension "${by}", expected one of ${ATTRIBUTION_DIMENSIONS.join(", ")}` });
      return;
    }
    const events = eventStore.all().filter((event) => event.team === team);
    res.json({ by, rows: attributeBy(events, by) });
  });

  app.get("/anomalies", (req: Request, res: Response) => {
    const team = resolveTeam(req);
    const events = eventStore.all().filter((event) => event.team === team);

    const options: { minBaselinePoints?: number; zScoreThreshold?: number } = {};
    if (req.query.minBaselinePoints !== undefined) {
      const parsed = Number(req.query.minBaselinePoints);
      if (!Number.isFinite(parsed) || parsed < 0) {
        res.status(400).json({ error: "minBaselinePoints must be a non-negative number" });
        return;
      }
      options.minBaselinePoints = parsed;
    }
    if (req.query.zScoreThreshold !== undefined) {
      const parsed = Number(req.query.zScoreThreshold);
      if (!Number.isFinite(parsed)) {
        res.status(400).json({ error: "zScoreThreshold must be a number" });
        return;
      }
      options.zScoreThreshold = parsed;
    }

    res.json({ anomalies: detectAnomalies(events, options) });
  });

  const budgets = express.Router();

  budgets.get("/", (req: Request, res: Response) => {
    res.json({ budgets: budgetStore.listForTeam(resolveTeam(req)) });
  });

  budgets.get("/status", (req: Request, res: Response) => {
    const team = resolveTeam(req);
    const events = eventStore.all().filter((event) => event.team === team);
    const configs = budgetStore.listForTeam(team);
    res.json({ statuses: evaluateBudgets(events, configs) });
  });

  budgets.put("/:period", (req: Request, res: Response) => {
    const period = req.params.period as BudgetPeriod;
    if (period !== "daily" && period !== "monthly") {
      res.status(400).json({ error: `invalid period "${period}", expected "daily" or "monthly"` });
      return;
    }
    const { softLimitUsd, hardLimitUsd } = req.body as { softLimitUsd?: unknown; hardLimitUsd?: unknown };
    if (
      typeof softLimitUsd !== "number" ||
      typeof hardLimitUsd !== "number" ||
      softLimitUsd < 0 ||
      hardLimitUsd < softLimitUsd
    ) {
      res.status(400).json({
        error: "softLimitUsd and hardLimitUsd must be numbers with hardLimitUsd >= softLimitUsd >= 0",
      });
      return;
    }
    const config = { team: resolveTeam(req), period, softLimitUsd, hardLimitUsd };
    budgetStore.upsert(config);
    res.status(200).json({ budget: config });
  });

  budgets.delete("/:period", (req: Request, res: Response) => {
    const period = req.params.period as BudgetPeriod;
    const removed = budgetStore.remove(resolveTeam(req), period);
    res.status(removed ? 204 : 404).end();
  });

  app.use("/budgets", budgets);

  return app;
}
