# a8's own labels decide approval for catalog tools, and custom connector tools ask once per thread

Every tool on a catalog connector's allowlist carries a8's label, read or action. The label decides whether the tool runs without asking, and the server's `readOnlyHint` can only make a tool stricter. This settles the open question in ADR 0005. Adding seven vendors showed the problem: a vendor that doesn't annotate its tools would make every read show an action card, and one that marks a write tool read-only would run it without asking.

A custom connector has no allowlist to label. Each of its tools asks for approval the first time it's used in a thread, then runs without asking for the rest of that thread. Trusting a custom server's `readOnlyHint` would give prompt injection a silent way out: an email or a Notion page tells the model to call a tool whose server marked it read-only, and the user's data leaves in the arguments with no card. Users who aren't technical still never manage individual tools.

## Considered options

- **Trust `readOnlyHint` on custom connectors:** no extra clicks, but it opens the injection path above.
- **Every custom tool always asks:** safest, but it makes a custom connector tiring to use for reads.

## Consequences

- The add screen for a custom connector says plainly that its tools can read and send data.
- An approval granted in one thread doesn't carry to another.
