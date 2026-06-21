// Zero-dependency dev server for the web fixture, so the heavy-tier web smoke
// can `npm run dev` it without installing Vite/Next. Binds the port from $PORT
// (the harness picks a free one) and serves the fixture's index.html.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"));
const port = Number(process.env.PORT) || 5173;

createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(html);
}).listen(port, "127.0.0.1", () => {
  console.log(`pf-e2e-web-fixture dev server on http://127.0.0.1:${port}`);
});
