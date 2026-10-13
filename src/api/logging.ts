export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

function write(stream: NodeJS.WritableStream, level: string, event: string, fields: Record<string, unknown>): void {
  stream.write(`${JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })}\n`);
}

/** One JSON object per line (info/warn to stdout, error to stderr) so a log shipper, `jq`, or a
 * plain redirect to a file gets machine-parseable structured logs instead of ad-hoc strings. */
export function createLogger(): Logger {
  return {
    info: (event, fields = {}) => write(process.stdout, "info", event, fields),
    warn: (event, fields = {}) => write(process.stdout, "warn", event, fields),
    error: (event, fields = {}) => write(process.stderr, "error", event, fields),
  };
}

export const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
