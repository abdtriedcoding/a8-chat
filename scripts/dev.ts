// Runs `next dev` on PORT from .env.local (set per worktree), default 3000.
// Next ignores PORT from .env files, so pass it as a flag.
const port = process.env.PORT ?? "3000";
const p = Bun.spawn(["bunx", "next", "dev", "-p", port], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(await p.exited);
