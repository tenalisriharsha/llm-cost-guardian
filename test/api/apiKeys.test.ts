import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiKeyRegistry, hashApiKey } from "../../src/api/apiKeys.js";

describe("hashApiKey", () => {
  it("is deterministic and never returns the input itself", () => {
    expect(hashApiKey("my-key")).toBe(hashApiKey("my-key"));
    expect(hashApiKey("my-key")).not.toBe("my-key");
  });

  it("produces different hashes for different keys", () => {
    expect(hashApiKey("key-one")).not.toBe(hashApiKey("key-two"));
  });
});

describe("ApiKeyRegistry (plaintext constructor)", () => {
  it("authenticates a known key and defaults role to team", () => {
    const registry = new ApiKeyRegistry([{ key: "secret", apiKeyId: "id-1", team: "platform" }]);
    expect(registry.authenticate("secret")).toEqual({ apiKeyId: "id-1", team: "platform", role: "team" });
  });

  it("honors an explicit role", () => {
    const registry = new ApiKeyRegistry([{ key: "secret", apiKeyId: "id-1", team: "ops", role: "admin" }]);
    expect(registry.authenticate("secret")).toEqual({ apiKeyId: "id-1", team: "ops", role: "admin" });
  });

  it("rejects an unknown key and an undefined key", () => {
    const registry = new ApiKeyRegistry([{ key: "secret", apiKeyId: "id-1", team: "platform" }]);
    expect(registry.authenticate("not-it")).toBeNull();
    expect(registry.authenticate(undefined)).toBeNull();
  });
});

describe("ApiKeyRegistry.fromFile", () => {
  function writeKeyFile(records: unknown[]): string {
    const dir = mkdtempSync(join(tmpdir(), "lcg-apikeys-"));
    const file = join(dir, "api-keys.json");
    writeFileSync(file, JSON.stringify(records));
    return file;
  }

  it("authenticates by hash, not plaintext — the file never stores a usable key", () => {
    const file = writeKeyFile([
      {
        apiKeyId: "id-1",
        team: "platform",
        role: "team",
        keyHash: hashApiKey("raw-secret"),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const registry = ApiKeyRegistry.fromFile(file);
    expect(registry.authenticate("raw-secret")).toEqual({ apiKeyId: "id-1", team: "platform", role: "team" });
    expect(registry.authenticate(hashApiKey("raw-secret"))).toBeNull();
  });

  it("skips revoked keys", () => {
    const file = writeKeyFile([
      {
        apiKeyId: "id-1",
        team: "platform",
        role: "team",
        keyHash: hashApiKey("raw-secret"),
        createdAt: "2026-01-01T00:00:00.000Z",
        revokedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    const registry = ApiKeyRegistry.fromFile(file);
    expect(registry.authenticate("raw-secret")).toBeNull();
  });
});
