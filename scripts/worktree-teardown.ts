// Deletes this linked worktree's Convex dev deployment, the one
// worktree-setup.ts created. Run after the PR merges. Does nothing in the
// main checkout, and refuses any deployment that isn't a non-default dev one.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const git = (...args: string[]) =>
  spawnSync("git", args, { encoding: "utf8" }).stdout.trim();

const worktree = resolve(process.cwd());
const root = dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir"));
if (resolve(root) === worktree) {
  console.log("main checkout, nothing to do");
  process.exit(0);
}

const envPath = resolve(worktree, ".env.local");
const name = existsSync(envPath)
  ? readFileSync(envPath, "utf8").match(/^CONVEX_DEPLOYMENT=dev:([\w-]+)/m)?.[1]
  : undefined;
if (!name) {
  console.log("no dev deployment in .env.local, nothing to do");
  process.exit(0);
}

// The Convex CLI's login token also works for the Management API.
const { accessToken } = JSON.parse(readFileSync(resolve(homedir(), ".convex/config.json"), "utf8"));
const api = `https://api.convex.dev/v1/deployments/${name}`;
const headers = { Authorization: `Bearer ${accessToken}` };

const info = await fetch(api, { headers });
if (info.status === 404) {
  console.log(`deployment ${name} already gone`);
  process.exit(0);
}
if (!info.ok) throw new Error(`lookup of ${name} failed: ${info.status}`);
const { deploymentType, isDefault, reference } = await info.json();
if (deploymentType !== "dev" || isDefault || !String(reference).startsWith("dev/")) {
  throw new Error(`${name} is not a worktree dev deployment (${deploymentType}, ${reference}), not deleting`);
}

const res = await fetch(`${api}/delete`, { method: "POST", headers });
if (!res.ok) throw new Error(`delete of ${name} failed: ${res.status}`);
console.log(`deleted deployment ${name} (${reference})`);
