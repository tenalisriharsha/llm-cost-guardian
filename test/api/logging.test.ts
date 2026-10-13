import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, noopLogger } from "../../src/api/logging.js";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info as a JSON line to stdout with level, event, ts, and extra fields", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    createLogger().info("http_request", { status: 200, team: "platform" });

    expect(write).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(write.mock.calls[0]?.[0]).trim());
    expect(line).toMatchObject({ level: "info", event: "http_request", status: 200, team: "platform" });
    expect(typeof line.ts).toBe("string");
  });

  it("writes error to stderr, not stdout", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    createLogger().error("boom", { reason: "disk full" });

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(stderr.mock.calls[0]?.[0]).trim());
    expect(line).toMatchObject({ level: "error", event: "boom", reason: "disk full" });
  });
});

describe("noopLogger", () => {
  it("never writes anything", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    noopLogger.info("whatever");
    noopLogger.warn("whatever");
    noopLogger.error("whatever");
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });
});
