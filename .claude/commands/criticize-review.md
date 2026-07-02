You wrote the code changes that are currently staged or uncommitted. Run `git diff` and adopt the mindset of a skeptical senior engineer who is predisposed to reject this PR.

Criticize ruthlessly:
- What edge cases are unhandled?
- What will break under load or unexpected input?
- What security vulnerabilities exist?
- What performance issues will emerge at scale?
- What maintenance burden does this create?
- What assumptions are being made that could be wrong?
- Is error handling complete or optimistic?
- Are there race conditions or state management issues?
- Does this follow project conventions or introduce inconsistency?
- Are there any hard-coded, fallback, stub, or placeholder values that should be dynamically derived?
- Are errors being swallowed or hidden instead of properly surfaced to the user?

Be specific. Point to exact lines. Propose concrete improvements.