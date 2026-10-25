# Page Notes

Leave feedback directly on a deployed page. Pin a comment, rewrite some text, then export the review for your coding agent.

Private prototype. Runs locally in Chrome; no account, backend, API key, or build step required to use it.

## Install

1. Clone this repo (or download the `page-notes-chrome` artifact from a successful GitHub Actions run and unzip it).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and choose this repo's **`extension`** folder (or the unzipped artifact folder containing `manifest.json`).
4. Pin **Page Notes** to the Chrome toolbar.
5. Visit the page you want to review, click the extension, then **Review this page**.

After updating the repo, click **Reload** on the extension card in `chrome://extensions`, then refresh the page before starting another review.

## Review a page

- **Browse:** navigate within the page and scroll normally.
- **Pin:** choose **Pin to element** (hover outlines the element you'll pin; the note follows it as you scroll or resize) or **Pin to page** (the note stays at that spot in the page content), then click and write feedback.
- **Edit text:** click visible text and type directly on the page. Each edit covers one run of plain text (⌘/Ctrl+A selects just that run); inline formatting and neighboring elements stay intact. ⌘/Ctrl+B, I and U toggle bold, italic and underline and ⇧⌘/Ctrl+X toggles strikethrough on the selection (or on what you type next). Enter saves, Shift+Enter adds a line break, Esc cancels, ⌘/Ctrl+Z undoes, and clicking elsewhere saves. While you type, the element is temporarily `contenteditable` and your keystrokes are kept from the site's own keyboard shortcuts.
- **Remove:** hover to outline a section in red, click to remove it from the page. Restore it from the panel.
- Review and remove feedback or revert a text edit or restore a removed section in the panel.
- **Move the panel:** drag its header, or the minimized pill, anywhere — partly off screen is fine. The corner button snaps it to the nearest corner. Clicking a pin highlights its note in the panel; use **Edit** there to change it.
- **Download review:** saves one Markdown file named with the date, time and page title (e.g. `2026-10-24 14-05 Pricing.md`). Chrome's Save As dialog lets you choose the folder.

The digest is short and readable, so you can check what you're sending. A header gives the page, timing, browser and viewport, then a short "How to address this review" block for the agent. Each item lists what to change (your note, or the exact original → replacement, keeping inline markup) and how to find it in source: the exact text with ~80 characters either side and how often it appears, the section heading path and landmark, a stable locator (test id › id › role + name › short path), the element's non-hashed classes and a short excerpt. There is no full-page HTML, no form values and no action history. The format is in [docs/format.md](docs/format.md).

Give the file to your agent along with the source project:

> Implement the review in this Markdown file in this repository, following its "How to address this review" section.

## Scope and limitations

- Reviews are temporary, in memory in the current tab. Export before refreshing, navigating away, or closing it. There is no automatic recovery after a browser crash.
- Text edits preview changes in the current DOM. They do not save to the website or source code. A framework can replace edited nodes; review conflicts before using the export.
- Page pins are fixed document CSS-pixel positions. Element pins also store selectors, text context and relative offsets. Neither guarantees correct placement on a different viewport, a redesigned page, or an element the site replaces.
- Main document only: iframe content, Shadow DOM content, PDFs, browser internal pages and the Chrome Web Store are not supported. Pin around unsupported content instead.
- Text edits change one run of text; formatting shortcuts add or remove `<strong>`/`<em>`/`<u>`/`<s>` inside that run only and can't undo formatting the site applied around it. Forms, password fields, existing rich-text editors, canvases and SVG text aren't editable. Drawing, layout reordering, screenshots, source maps and automatic PRs are future work.
- The digest includes only text near each item, never the whole page. Hidden text, scripts, form values, query strings and URL fragments are left out, hashed class names are dropped, and every field is capped, so even huge or hostile pages give a few KB per item.
- The controls use a closed Shadow DOM and require real user events. This is not a security boundary against the host website: its scripts can observe live text previews, and existing event handlers or DOM observers may react. Use on pages you trust; do not type private secrets into feedback.
- The digest can still quote visible private content near an item, and the page URL. Read it before sharing. The extension sends nothing over the network; the site itself continues operating normally.
- Failed or canceled downloads keep the draft for retry. Saving a file does not change your website.
- Native modal dialogs make the review controls inaccessible. Close the dialog before starting or continuing a review. Rotated/skewed elements and complex visual occlusion are not guaranteed; anchors use bounding rectangles.

## Development

```sh
npm ci
npx playwright install chromium
npm test
npm run check
npm run test:browser
npm run package
# Linux only: actual Chrome action / activeTab permission test
npm run test:activation
```

`extension/` is the installable source. Development uses Node 24; packaging also uses Python 3’s standard ZIP library. `npm run package` produces `dist/page-notes.zip`. Tests use only synthetic local pages; never commit a real review export.

See [architecture](docs/architecture.md) and [handoff format](docs/format.md). Delivery is separated from capture and editing so future integrations can implement a destination without rewriting the review UI.

See [testing report](docs/testing.md) for coverage, fixes and the boundaries of automated verification.
