# Project Rules — kiv-clinic

These rules are mandatory and must never be broken in this working directory.

## Git identity — single account only
- The ONLY git identity allowed for this project is the **kivclinic-web** GitHub account:
  - `user.name = kivclinic-web`
  - `user.email = 297182821+kivclinic-web@users.noreply.github.com`
- Every commit must be authored AND committed by this identity.
- Never set, restore, or reference any other personal name or email as the git
  author/committer. A previous personal account was intentionally removed from this
  machine's git config and keychain — it must never be reintroduced anywhere
  (commits, config, files, branch names, messages, or comments).

## No Claude co-authorship
- No commit may credit Claude as a co-author.
- Never append a `Co-Authored-By: Claude ...` trailer to any commit message.
- Never add a "Generated with Claude Code" line to any commit or pull request body.

## Identity hygiene
- Do not write the previous account owner's name or email into any file, config,
  commit, log, or output.
- All work and attribution flows through the kivclinic-web account.

## Credentials
- Stored credentials for any prior GitHub login have been removed from the macOS
  keychain. Authentication for pushes uses the kivclinic-web account only.
