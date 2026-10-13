import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type ApiKeyRole = "team" | "admin";

/** Plaintext input shape — used to build a registry in-process (tests, or right after `createKey`). */
export interface ApiKeyRecord {
  key: string;
  apiKeyId: string;
  team: string;
  role?: ApiKeyRole;
}

/** At-rest shape (config/api-keys.json): the raw key is never stored, only its hash. */
export interface StoredApiKeyRecord {
  apiKeyId: string;
  team: string;
  role: ApiKeyRole;
  keyHash: string;
  createdAt: string;
  revokedAt?: string;
}

export interface AuthContext {
  apiKeyId: string;
  team: string;
  role: ApiKeyRole;
}

/** SHA-256 is enough here: these are high-entropy random tokens (see `generateRawKey`), not
 * user-chosen passwords, so there's no offline dictionary-guessing risk to defend against with a
 * slow hash — the same reasoning GitHub/Stripe use for hashing API tokens at rest. */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/**
 * Looks up bearer tokens against a configured set of per-team API keys. Indexed by key hash, not
 * plaintext, so a leaked registry (or a leaked `config/api-keys.json`) can't be used to
 * authenticate — the same property the on-disk format provides.
 */
export class ApiKeyRegistry {
  private readonly byHash = new Map<string, AuthContext>();

  constructor(records: ApiKeyRecord[]) {
    for (const record of records) {
      this.byHash.set(hashApiKey(record.key), {
        apiKeyId: record.apiKeyId,
        team: record.team,
        role: record.role ?? "team",
      });
    }
  }

  /** Loads the hashed, at-rest format, skipping any key that has been revoked. */
  static fromFile(filePath: string): ApiKeyRegistry {
    const stored = JSON.parse(readFileSync(filePath, "utf8")) as StoredApiKeyRecord[];
    const registry = new ApiKeyRegistry([]);
    for (const record of stored) {
      if (record.revokedAt) continue;
      registry.byHash.set(record.keyHash, { apiKeyId: record.apiKeyId, team: record.team, role: record.role });
    }
    return registry;
  }

  authenticate(key: string | undefined): AuthContext | null {
    if (!key) return null;
    return this.byHash.get(hashApiKey(key)) ?? null;
  }
}
