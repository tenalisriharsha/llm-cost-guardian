import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashApiKey } from "../../src/api/apiKeys.js";
import { createKey, generateRawKey, loadKeyFile, revokeKey, saveKeyFile } from "../../src/api/keyManagement.js";

describe("generateRawKey", () => {
  it("is prefixed and unique across calls", () => {
    const a = generateRawKey();
    const b = generateRawKey();
    expect(a).toMatch(/^lcg_/);
    expect(a).not.toBe(b);
  });
});

describe("createKey", () => {
  it("returns a raw key whose hash matches the stored record, and defaults role to team", () => {
    const { record, rawKey } = createKey({ apiKeyId: "id-1", team: "platform", now: new Date("2026-01-01T00:00:00.000Z") });
    expect(record).toEqual({
      apiKeyId: "id-1",
      team: "platform",
      role: "team",
      keyHash: hashApiKey(rawKey),
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("honors an explicit role", () => {
    const { record } = createKey({ apiKeyId: "id-1", team: "ops", role: "admin" });
    expect(record.role).toBe("admin");
  });
});

describe("revokeKey", () => {
  it("sets revokedAt on a matching, not-yet-revoked record and returns true", () => {
    const { record } = createKey({ apiKeyId: "id-1", team: "platform" });
    const records = [record];
    const now = new Date("2026-02-01T00:00:00.000Z");
    expect(revokeKey(records, "id-1", now)).toBe(true);
    expect(records[0]?.revokedAt).toBe(now.toISOString());
  });

  it("returns false for an unknown id", () => {
    expect(revokeKey([], "no-such-id")).toBe(false);
  });

  it("returns false for an already-revoked key", () => {
    const { record } = createKey({ apiKeyId: "id-1", team: "platform" });
    const records = [record];
    revokeKey(records, "id-1");
    expect(revokeKey(records, "id-1")).toBe(false);
  });
});

describe("loadKeyFile / saveKeyFile", () => {
  it("round-trips records through a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcg-keyfile-"));
    const file = join(dir, "api-keys.json");
    const { record } = createKey({ apiKeyId: "id-1", team: "platform" });

    saveKeyFile(file, [record]);
    expect(loadKeyFile(file)).toEqual([record]);
  });
});
