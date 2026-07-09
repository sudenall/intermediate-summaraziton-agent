#!/usr/bin/env node
// Zero-dependency static file server, just so the browser can load the demo
// as ES modules (which requires http:// rather than file://). No external
// packages: only Node's built-in http/fs/path modules.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // project root
const port = Number(process.argv[2]) || 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") {
    // Redirect (rather than silently rewrite) so the browser's resolved
    // page URL is /web/, and the page's own relative imports/links
    // (./app.js, ./styles.css, ../src/...) resolve correctly.
    res.writeHead(302, { Location: "/web/index.html" });
    res.end();
    return;
  }

  const filePath = path.join(root, urlPath);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found: " + urlPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Demo running at http://localhost:${port}/`);
});
