# Assignment Ledger configuration instructions

When the user asks to install, configure, personalize, or set up this project, follow `SETUP_WITH_CODEX.md` completely. Treat `config/tracker.json` as unconfigured when its manager name or Slack user ID is empty.

The setup must be interview-led. Never guess a Slack identity from a partial or common name. Resolve and confirm every manager and tracked assignee before writing configuration or creating the recurring automation.

Preserve the existing dashboard layout, styling, two-ledger behavior, local D1 persistence, archive/unarchive behavior, and evidence rules. Do not simplify or redesign the UI during setup.

Use `node scripts/ledger-cli.mjs` for listener database writes on both Windows and macOS. Do not make the listener depend on the dashboard or POST captured data to localhost.

At the end of successful configuration, run the verification steps and `npm run launch`. This command installs missing project packages, starts the local dashboard, and opens it in the user's default browser.
