// Orca setup hook. Gives a linked git worktree its own .env.local, dev port,
// and Convex dev deployment. Does nothing in the main checkout.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const run = (cmd: string[], cwd: string, input?: string) => {
  // Bun loads the worktree's .env.local into process.env. Drop CONVEX_DEPLOYMENT
  // so the Convex CLI reads the deployment from the cwd's .env.local instead.
  const env = { ...process.env };
  delete env.CONVEX_DEPLOYMENT;
  const p = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    env,
    input,
    stdio: [input === undefined ? "inherit" : "pipe", "pipe", "inherit"],
  });
  if (p.status !== 0) throw new Error(`${cmd.join(" ")} failed`);
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
// Create fails when the deployment already exists (a re-run), which is fine.
// It expires on its own as a safety net if worktree-teardown.ts never runs.
// New dev deployments start with the project's default env vars (see below).
try {
  convex("deployment", "create", `dev/${name}`, "--type", "dev", "--expiration", "in 5 days");
} catch {}
convex("deployment", "select", `dev/${name}`); // rewrites the Convex lines in .env.local
const target = ["--deployment", `dev/${name}`]; // never fall back to main's deployment

// Everything except SITE_URL comes from the project's dev env defaults. Set them
// once with `bunx convex env default set --type dev NAME value`. Fail early
// instead of leaving a worktree with a half-configured deployment.
// ANTHROPIC_BYOK_API_KEY is optional for the app, but without it a worktree
// spends gateway credits on Claude. TEMPORARY: drop it from the list once
// spec #334 is done, with the rest of the BYOK key.
const defaults = convex("env", "default", "list", "--type", "dev", "--names-only").split(/\r?\n/).map((l) => l.trim());
const required = ["AI_GATEWAY_API_KEY", "ANTHROPIC_BYOK_API_KEY", "BETTER_AUTH_SECRET", "CONNECTION_ENCRYPTION_KEY"];
const missing = required.filter((k) => !defaults.includes(k));
if (missing.length) throw new Error(`project dev env defaults are missing ${missing.join(", ")}`);
convex("env", "set", ...target, "SITE_URL", siteUrl);

let env = readFileSync(envPath, "utf8").replace(/^(NEXT_PUBLIC_SITE_URL|PORT)=.*\r?\n?/gm, "");
env += `\nNEXT_PUBLIC_SITE_URL=${siteUrl}\nPORT=${port}\n`;
writeFileSync(envPath, env);

convex("dev", "--once");

// Convex checks tokens against the JWKS env var instead of fetching Better
// Auth's keys over HTTP. The action creates the deployment's first key, so it
// runs after the push. Setting the var makes Convex reload auth.config.ts.
// The value goes through stdin to keep the encrypted private key out of argv.
const jwks = convex("run", ...target, "auth:getLatestJwks");
run(["bunx", "convex", "env", "set", ...target, "JWKS"], worktree, jwks);

// Seed the shared e2e login so agents sign in instead of signing up each time.
// E2E_EMAIL and E2E_PASSWORD_HASH come from the main checkout's .env.local,
// copied above. Skip when they're not set.
const envVar = (key: string) => readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
const e2eEmail = envVar("E2E_EMAIL");
const e2eHash = envVar("E2E_PASSWORD_HASH");
if (e2eEmail && e2eHash) {
  const component = ["--component", "betterAuth"];
  const found = convex(
    "run", ...target, ...component, "adapter:findOne",
    JSON.stringify({ model: "user", where: [{ field: "email", value: e2eEmail }] }),
  ).trim();
  if (!found || found === "null") {
    const create = (model: string, data: object) =>
      JSON.parse(convex("run", ...target, ...component, "adapter:create", JSON.stringify({ input: { model, data } })));
    const now = Date.now();
    const user = create("user", { name: "E2E Test", email: e2eEmail, emailVerified: true, createdAt: now, updatedAt: now });
    create("account", {
      accountId: user._id,
      providerId: "credential",
      userId: user._id,
      password: e2eHash,
      createdAt: now,
      updatedAt: now,
    });
  }
}

console.log(`worktree ${name}: ${siteUrl}, deployment dev/${name}`);
