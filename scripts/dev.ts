// Runs `next dev` on PORT from .env.local (set per worktree), default 3000.
// Next ignores PORT from .env files, so pass it as a flag.
import { spawnSync } from "node:child_process";

const port = process.env.PORT ?? "3000";
const p = spawnSync("bunx", ["next", "dev", "-p", port], { stdio: "inherit" });
process.exit(p.status ?? 1);
