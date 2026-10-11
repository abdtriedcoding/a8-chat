// Orca setup hook. Gives a linked git worktree its own .env.local, dev port,
// and Convex dev deployment. Does nothing in the main checkout.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const run = (cmd: string[], cwd: string) => {
  // Bun loads the worktree's .env.local into process.env. Drop CONVEX_DEPLOYMENT
  // so the Convex CLI reads the deployment from the cwd's .env.local instead.
  const env = { ...process.env };
  delete env.CONVEX_DEPLOYMENT;
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "inherit" });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed`);
  return p.stdout.toString();
};

const worktree = resolve(process.cwd());
const common = run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], worktree).trim();
const root = dirname(common);
if (resolve(root) === worktree) {
  console.log("main checkout, nothing to do");
  process.exit(0);
}

const name = basename(worktree).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const port = 3100 + (hash % 900);
const siteUrl = `http://localhost:${port}`;
const convex = (...args: string[]) => run(["bunx", "convex", ...args], worktree);

if (!existsSync(resolve(worktree, "node_modules"))) run(["bun", "install", "--frozen-lockfile"], worktree);

// Start from the main checkout's .env.local, then point it at a new deployment.
const envPath = resolve(worktree, ".env.local");
writeFileSync(envPath, readFileSync(resolve(root, ".env.local")));
const mainEnv = run(["bunx", "convex", "env", "list"], root) // main deployment, before selecting
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

// Create fails when the deployment already exists (a re-run), which is fine.
try {
  convex("deployment", "create", `dev/${name}`, "--type", "dev");
} catch {}
convex("deployment", "select", `dev/${name}`); // rewrites the Convex lines in .env.local
const target = ["--deployment", `dev/${name}`]; // never fall back to main's deployment

// Copy the main deployment's variables, except the ones tied to the port.
for (const line of mainEnv) {
  const i = line.indexOf("=");
  const key = line.slice(0, i);
  if (!key || key === "SITE_URL") continue;
  convex("env", "set", ...target, key, line.slice(i + 1));
}
convex("env", "set", ...target, "SITE_URL", siteUrl);

let env = readFileSync(envPath, "utf8").replace(/^(NEXT_PUBLIC_SITE_URL|PORT)=.*\r?\n?/gm, "");
env += `\nNEXT_PUBLIC_SITE_URL=${siteUrl}\nPORT=${port}\n`;
writeFileSync(envPath, env);

convex("dev", "--once");
console.log(`worktree ${name}: ${siteUrl}, deployment dev/${name}`);
