# One account per inbox, and credits that outlive a deleted account

Free gives every account 100 credits a month, and nothing tied credits to a person. The pre-launch QA on Oct 24, 2026 (issue #425) found two ways to get more. Most mail providers deliver `ann+1@x.com` and `ann+2@x.com` to `ann@x.com`, and Gmail ignores dots, so one inbox could hold many accounts at once. And deleting an account deleted its credit ledger, so signing up again with the same email started a fresh month.

a8 keeps an email key per account (`accountEmails`): the SHA-256 of the address lowercased, without a `+tag`, and without dots for Gmail (`convex/lib/emailKey.ts`). With billing on, sign-up, with a password or with Google, refuses an email whose key an account already has. Just before an account is deleted, the credits it used in its current period go under its key (`deletedUsage`) until that period ends. Costs that land after the deletion add to them. A new account with the same key in that time starts its first Free month with those credits used. That month runs from sign-up like any new account's. Ending it at the deleted account's reset instead would grant Free's credits twice within a few days.

## Considered options

- **Accept it at launch:** no code, but one inbox gets as many 100-credit months as it has aliases, which adds up with the per-user share of the daily spend ceiling.
- **Share one ledger across accounts with the same key:** aliases keep working, but every credit check would read across accounts, and deleting one account would have to split a shared balance.
- **Refuse a second account, and keep a deleted account's credits until its period ends (this ADR):** one account per inbox, and a deletion can't reset credits.

## Consequences

- Someone can create an account for an alias of another person's email. Any address with the key reaches that person's inbox, so the verification and password reset emails reach them, and they can take the account over.
- A provider that doesn't deliver `+tag` mail to the plain address still gets one account across its tagged addresses.
- The key is a hash, so a deleted account's row doesn't keep its email. The row goes when its period ends.
- Two sign-ups for the same key at the same moment can both pass, since the check runs before Better Auth creates the user and the key is added after.
- Someone who signs up again right after deleting can wait up to a month for fresh credits, where the deleted account would have reset sooner. Pro credits used before the deletion count against Free's grant, as they do after a refund.
- A cost that lands after the new account took the kept credits is lost. Costs land within a few minutes of a reply.
- Self-hosted a8 has no credits, so it keeps the keys but doesn't refuse aliases. Accounts made before this change get keys from `migrations:addAccountEmails`.
