// TLS-terminating reverse proxy for `next start` (browsers only allow the
// microphone on https:// or localhost). Streams responses unbuffered so the
// copilot's NDJSON reply still arrives token by token.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const certDir = process.env.CERT_DIR ?? path.join(os.homedir(), ".pdm-cnc-certs");
const listen = Number(process.env.HTTPS_PORT ?? 3001);
const target = { host: "127.0.0.1", port: Number(process.env.APP_PORT ?? 3101) };

https
  .createServer(
    {
      key: fs.readFileSync(path.join(certDir, "server.key")),
      cert: fs.readFileSync(path.join(certDir, "server.crt")),
    },
    (req, res) => {
      const up = http.request(
        {
          ...target,
          method: req.method,
          path: req.url,
          headers: {
            ...req.headers,
            "x-forwarded-proto": "https",
            "x-forwarded-for": req.socket.remoteAddress ?? "",
          },
        },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end("Upstream unavailable");
      });
      res.on("close", () => up.destroy()); // client left: stop the upstream (e.g. LLM) stream
      req.pipe(up);
    },
  )
  .listen(listen, "0.0.0.0", () =>
    console.log(`https://0.0.0.0:${listen} -> http://${target.host}:${target.port}`),
  );
