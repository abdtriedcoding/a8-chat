When reporting information to me, be extremely concise and sacrifice grammar for the sake of concision.

When a step doesn't need my input, keep going. Put status notes in the same message as your next action.
Stop and ask only when you can't continue without me, or before anything destructive: deleting data, force-pushing, or changing anything outside this repository.

Always apply the `unslop` skill (`.claude/skills/unslop/SKILL.md`) to everything you write: replies to me, commit messages, PR descriptions, issues, docs, and code comments.

## Agent skills

### Issue tracker

GitHub Issues on `abdtriedcoding/a8-chat`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary, label string = role name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
