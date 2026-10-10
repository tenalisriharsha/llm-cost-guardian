import { readFileSync } from "node:fs";

export interface ApiKeyRecord {
  key: string;
  apiKeyId: string;
  team: string;
}

export interface AuthContext {
  apiKeyId: string;
  team: string;
}

/** Looks up bearer tokens against a configured set of per-team API keys (config/api-keys.json by default). */
export class ApiKeyRegistry {
  private readonly byKey = new Map<string, AuthContext>();

  constructor(records: ApiKeyRecord[]) {
    for (const record of records) {
      this.byKey.set(record.key, { apiKeyId: record.apiKeyId, team: record.team });
    }
  }

  static fromFile(filePath: string): ApiKeyRegistry {
    const records = JSON.parse(readFileSync(filePath, "utf8")) as ApiKeyRecord[];
    return new ApiKeyRegistry(records);
  }

  authenticate(key: string | undefined): AuthContext | null {
    if (!key) return null;
    return this.byKey.get(key) ?? null;
  }
}
