import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { hashApiKey, type ApiKeyRole, type StoredApiKeyRecord } from "./apiKeys.js";

/** `lcg_` prefix makes a leaked key greppable/identifiable in logs, same idea as `sk-`/`ghp_`. */
export function generateRawKey(): string {
  return `lcg_${randomBytes(24).toString("base64url")}`;
}

export function loadKeyFile(filePath: string): StoredApiKeyRecord[] {
  return JSON.parse(readFileSync(filePath, "utf8")) as StoredApiKeyRecord[];
}

export function saveKeyFile(filePath: string, records: StoredApiKeyRecord[]): void {
  writeFileSync(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export interface CreateKeyOptions {
  apiKeyId: string;
  team: string;
  role?: ApiKeyRole;
  now?: Date;
}

export interface CreatedKey {
  record: StoredApiKeyRecord;
  rawKey: string;
}

/** Generates a fresh random key and its at-rest record. The plaintext `rawKey` is returned once
 * and never persisted anywhere — the caller (the CLI) is responsible for showing it to the
 * operator exactly once. */
export function createKey(options: CreateKeyOptions): CreatedKey {
  const rawKey = generateRawKey();
  const record: StoredApiKeyRecord = {
    apiKeyId: options.apiKeyId,
    team: options.team,
    role: options.role ?? "team",
    keyHash: hashApiKey(rawKey),
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  return { record, rawKey };
}

/** Marks a key revoked in place. Returns false if no matching, not-already-revoked key exists. */
export function revokeKey(records: StoredApiKeyRecord[], apiKeyId: string, now: Date = new Date()): boolean {
  const record = records.find((r) => r.apiKeyId === apiKeyId && !r.revokedAt);
  if (!record) return false;
  record.revokedAt = now.toISOString();
  return true;
}
