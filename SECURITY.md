# Security

## Reporting a vulnerability

Found a security issue?

- Use GitHub's [Private Vulnerability Reporting](https://github.com/vesaias/specgen/security/advisories/new) (preferred)
- Or message me via the GitHub profile

## Threat model

SpecGen is designed to run as a **single-user, localhost-only tool**. The HTTP server defaults to `127.0.0.1:6101` and ships without authentication.

**Don't expose port 6101 to a LAN, the internet, or any mesh network.** Anyone who can reach the loopback interface has full read/write access to every project, every stored connector token (post-decrypt), and the ability to trigger AI and Playwright runs against arbitrary URLs.

Binding to a non-loopback address is refused at boot unless `SPECGEN_ALLOW_PUBLIC=1` is set explicitly.

## Credentials stored

SpecGen stores these in the encrypted token store (AES-256-GCM, master key at `dirname(SPECGEN_DB)/secret.key` or via `SPECGEN_SECRET_KEY` env):

- AI provider API keys (Anthropic, OpenAI)
- GitHub Personal Access Tokens (for repo source + git-docs push)
- Confluence API tokens (email + token)
- Frontend-capture auth — form passwords, cookie values, header values, basic-auth credentials, localStorage values

All are local to your SQLite database. If you lose `secret.key`, every stored token is unrecoverable — back up the DB and the key together. Treat your data directory as sensitive.
