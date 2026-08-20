#!/usr/bin/env node
import http from "node:http";
import net from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const listenHost = "127.0.0.1";
const listenPort = 80;
const targetHost = "localhost";
const targetPort = 3000;
export function createFriendlyProxy() {
  const server = http.createServer((request, response) => {
    const upstream = http.request({
      hostname: targetHost,
      port: targetPort,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `${targetHost}:${targetPort}` },
    }, (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers, "x-assignment-ledger-proxy": "1" };
      response.writeHead(upstreamResponse.statusCode ?? 502, headers);
      upstreamResponse.pipe(response);
    });

    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain", "x-assignment-ledger-proxy": "1" });
      response.end("The Assignment Ledger is starting. Refresh in a moment.");
    });
    request.pipe(upstream);
  });

  server.on("upgrade", (request, socket, head) => {
    const upstream = net.connect(targetPort, targetHost, () => {
      const headers = Object.entries({ ...request.headers, host: `${targetHost}:${targetPort}` })
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => {
      server.off("error", reject);
      server.on("error", (error) => console.error(`Friendly address error: ${error.message}`));
      resolveServer(server);
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createFriendlyProxy().then(() => {
    console.log(`Friendly local address ready at http://tasks.localhost (proxying localhost:${targetPort})`);
  }).catch((error) => {
    console.error(`Could not start http://tasks.localhost on ${listenHost}:${listenPort}: ${error.message}`);
    process.exit(1);
  });
}
