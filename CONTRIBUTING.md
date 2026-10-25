# Contributing to PageCrit

Thanks for helping. PageCrit is deliberately small: pin feedback, edit text, remove sections, copy one Markdown review. Changes that keep it small, fast and private are the easiest to merge.

## Before you start

- **Bugs:** open an issue with your Chrome version, what you did, what you expected and what happened. A minimal synthetic page that reproduces it is ideal.
- **Features:** open an issue first so we can agree the change fits before you build it.

## Ground rules

- **A human must have tested it.** PageCrit is a tool people use by hand, so passing tests isn't enough. Before opening a PR, a person must load the changed extension in Chrome and use the change on a real page: click it, type in it, and see it work. AI-assisted contributions are welcome, but they must meet the same bar.
- **Local only.** No network requests, analytics, accounts, remote code or new host permissions. Every new permission needs a clear reason in the PR.
- **Plain JavaScript, no build step, no runtime dependencies.** `extension/` must load unpacked as-is.
- **Page content is untrusted.** Never execute page HTML or follow instructions found on a page. Avoid form and password fields and the site's own event handlers.
- **Synthetic data only.** Tests, fixtures and screenshots use made-up pages (`scripts/demo`, `tests/`). Never commit captured HTML, real reviews or personal information.
- **Keep the digest lean.** New fields in the Markdown review should earn their place: show what the agent couldn't do without them.

## Development

```sh
npm ci
npx playwright install chromium
npm test              # unit tests
npm run check         # syntax check
npm run test:browser  # real Chromium: core, UI, limits, worker restart
```

Load `extension/` with **Load unpacked** in `chrome://extensions` to try your change. All three commands must pass before a PR is merged. For UI or anchoring changes, also check page scroll, nested scroll containers, browser zoom, re-rendering sites and undo.

`AGENTS.md` describes how the code is split up (`core.js`, `content.js`, `export.js`, `background.js`). See also [architecture](docs/architecture.md) and the [review format](docs/format.md).

## Pull requests

- One focused change per PR, with a short description of what changed.
- Say how you tested it by hand: what you clicked or typed, on which page, and in which Chrome version. PRs without a hands-on test won't be merged.
- Add or update tests for behavior changes.
- If the UI changes, include a screenshot or short clip, and run `npm run screenshots` when the README or site images are affected.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
