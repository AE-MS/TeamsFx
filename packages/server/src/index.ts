// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createMessageConnection } from "vscode-jsonrpc/node";
import WebSocket from "ws";

/**
 * solved by https://github.com/vercel/pkg/issues/420#issuecomment-652925540
 */
require("../standalone-patch");
import ServerConnection from "./serverConnection";

const port = Number(process.argv.slice(2)[0]) || 7920;
const wss = new WebSocket.Server({ port: port });

wss.on("connection", async function cb(ws) {
  const wsStream = WebSocket.createWebSocketStream(ws, { encoding: "utf8" });
  const connection = new ServerConnection(createMessageConnection(wsStream, wsStream));
  ws.on("message", (ms) => {
    console.log(`recv:${ms.toString()}`);
  });
  connection.listen();
});

let timeout: NodeJS.Timeout | undefined = undefined;

const interval = setInterval(() => {
  if (wss.clients.size === 0) {
    if (timeout === undefined) {
      timeout = setTimeout(() => wss.close(), 10 * 60 * 1000); // 10 minutes
    }
  } else {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  }
}, 5000);

wss.on("close", function close() {
  clearInterval(interval);
  console.log(`The server has been closed`);
});

console.log(`The server has started at ws://localhost:${port}`);
