import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { createServer as createVite } from "vite";

const WEB_ROOT = fileURLToPath(new URL("../web", import.meta.url));
const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));

// PORT, and CLAUDE_API_KEY (and CLAUDE_MODEL) for the agents; loaded before the API module reads them.
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const PORT = Number(process.env.PORT) || 5182;
const { handleApi } = await import("./api.js");

// One process: /api/* goes to the graph, everything else to Vite, which serves the React app in web/.
const server = createServer();
const vite = await createVite({
  root: WEB_ROOT,
  configFile: false,
  appType: "spa",
  plugins: [tailwindcss()],
  resolve: { alias: { "@": WEB_ROOT } },
  server: { middlewareMode: true, hmr: { server } },
});
server.on("request", (req, res) => (req.url?.startsWith("/api/") ? handleApi(req, res) : vite.middlewares(req, res)));
server.listen(PORT, "127.0.0.1", () => console.log(`Code graph UI: http://localhost:${PORT}`));
