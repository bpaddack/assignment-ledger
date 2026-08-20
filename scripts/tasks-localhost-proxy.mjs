#!/usr/bin/env node
import http from "node:http";
import net from "node:net";

const listenHost = "127.0.0.1";
const listenPort = 80;
const targetHost = "localhost";
const targetPort = 3000;
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

server.on("error", (error) => {
  console.error(`Could not start http://tasks.localhost on ${listenHost}:${listenPort}: ${error.message}`);
  process.exit(1);
});

server.listen(listenPort, listenHost, () => {
  console.log(`Friendly local address ready at http://tasks.localhost (proxying localhost:${targetPort})`);
});
