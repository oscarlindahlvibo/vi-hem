import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
// Public, disposable test credentials. Never used for any real VI-HEM service.
const qaSecret = "snow-local-test-secret-at-least-32-characters";
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
export default defineConfig({
  root: fileURLToPath(new URL("../../../", import.meta.url)),
  plugins: [
    react(),
    {
      name: "snow-local-session",
      configureServer(server) {
        server.middlewares.use("/__snow-qa-session", (_req, res) => {
          const expires = Math.floor(Date.now() / 1000) + 3600;
          const user = {
            id: "10000000-0000-0000-0000-000000000001",
            role: "authenticated",
            aud: "authenticated",
            email: "snow-qa@example.invalid",
            app_metadata: {},
            user_metadata: {},
          };
          let token =
            encode({ alg: "HS256", typ: "JWT" }) +
            "." +
            encode({ role: "authenticated", sub: user.id, exp: expires });
          token +=
            "." +
            createHmac("sha256", qaSecret).update(token).digest("base64url");
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(
            JSON.stringify({
              access_token: token,
              refresh_token: "local-qa-only",
              token_type: "bearer",
              expires_in: 3600,
              expires_at: expires,
              user,
            }),
          );
        });
      },
    },
  ],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      "http://127.0.0.1:5197",
    ),
    "import.meta.env.VITE_SUPABASE_USE_SAME_ORIGIN": JSON.stringify("false"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("local-qa-only"),
  },
  server: {
    host: "127.0.0.1",
    port: 5197,
    strictPort: true,
    proxy: {
      "/rest/v1": {
        target: "http://127.0.0.1:55450",
        rewrite: (path) => path.replace(/^\/rest\/v1/, ""),
      },
    },
  },
});
