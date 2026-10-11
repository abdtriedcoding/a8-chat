# a8's own labels decide approval for catalog tools, and custom connector tools ask on every call

Every tool on a catalog connector's allowlist carries a8's label, read or action. The label decides whether the tool runs without asking, and the server's `readOnlyHint` can only make a tool stricter. This settles the open question in ADR 0005. Adding seven vendors showed the problem: a vendor that doesn't annotate its tools would make every read show an action card, and one that marks a write tool read-only would run it without asking.

A custom connector has no allowlist to label, so in v1 every call to one of its tools asks for approval (#72). Custom connectors are planned, not built, but the code already treats a server without an allowlist this way. Trusting a custom server's `readOnlyHint` would give prompt injection a silent way out: an email or a Notion page tells the model to call a tool whose server marked it read-only, and the user's data leaves in the arguments with no card. Users who aren't technical still never manage individual tools.

This ADR first chose once-per-thread approval for custom tools. #72 started with the stricter rule, and once per thread stays the later option (#123).

## Considered options

- **Trust `readOnlyHint` on custom connectors:** no extra clicks, but it opens the injection path above.
- **Ask once per thread:** each tool asks the first time it's used in a thread, then runs without asking for the rest of that thread. Fewer cards for reads, but after the first approval a hidden instruction in an email or a page can call that tool again with no card. The later option (#123).

## Consequences

- Every call on a custom connector shows an action card, even one that only fetches, which makes a connector used mostly for lookups tiring.
- The add screen for a custom connector says plainly that its tools can read and send data.
- An approval covers one call. It doesn't carry to the next call or to another thread.
