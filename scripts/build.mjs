import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const files = [
  "index.html", "styles.css", "app.js", "service-worker.js",
  "manifest.webmanifest", "icon.svg"
];
const supabaseBrowserClient = path.join(root, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js");

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });
for (const file of files) await fs.copyFile(path.join(root, file), path.join(dist, file));
await fs.copyFile(supabaseBrowserClient, path.join(dist, "supabase.js"));

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ""
};
await fs.writeFile(path.join(dist, "config.js"), `window.APP_CONFIG = ${JSON.stringify(config)};\n`);
await fs.writeFile(path.join(dist, "_headers"), [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
  "",
  "/service-worker.js",
  "  Cache-Control: no-store, must-revalidate",
  "",
  "/index.html",
  "  Cache-Control: no-store, must-revalidate",
  "",
  "/app.js",
  "  Cache-Control: no-store, must-revalidate",
  "",
  "/styles.css",
  "  Cache-Control: no-store, must-revalidate",
  "",
  "/supabase.js",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
  "/config.js",
  "  Cache-Control: no-store",
].join("\n"));
await fs.writeFile(path.join(dist, "_redirects"), "# No redirect rules for Workers assets deployment.\n");
console.log("Dist files:", (await fs.readdir(dist)).sort().join(", "));
console.log(`Built Cloudflare Pages output in ${dist}`);
