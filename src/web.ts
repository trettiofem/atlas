import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { createServer as createVite } from "vite";
import { handleApi } from "./api.js";

const PORT = 5182;
const WEB_ROOT = fileURLToPath(new URL("../web", import.meta.url));

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
