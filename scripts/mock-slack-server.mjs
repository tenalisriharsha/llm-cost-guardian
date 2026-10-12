// A tiny real HTTP server standing in for a Slack incoming-webhook endpoint, for screenshot
// capture. Runs as its own OS process (not in-process with the orchestrator) so a scene's
// synchronous `spawnSync` call can't block it from answering: an in-process server sharing the
// orchestrator's event loop would never get to run its request handler while `spawnSync` blocks.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4322);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  req.on("data", () => {});
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });
});

server.listen(port, () => console.log(`mock slack webhook listening on ${port}`));
