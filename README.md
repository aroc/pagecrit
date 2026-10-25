<p align="center">
  <img src="site/assets/readme-banner.png" alt="PageCrit: mark up any web page and hand it to your coding agent. A pricing page with comment pins and the PageCrit review panel." width="100%">
</p>

<p align="center">
  <b>Mark up any web page. Hand it to your coding agent.</b><br>
  A Chrome extension for reviewing your own site: pin notes, edit text in place, strike sections,
  then copy one short Markdown review your agent can act on.
</p>

<p align="center">
  <a href="https://github.com/aroc/pagecrit/actions/workflows/check.yml"><img src="https://github.com/aroc/pagecrit/actions/workflows/check.yml/badge.svg" alt="Check extension"></a>
</p>

---

## What it does

<table>
  <tr>
    <td width="50%"><img src="site/assets/pin-hover.png" alt="Hovering a pricing card outlines it, next to placed pins"><br><b>Pin a note to anything.</b> Hover to outline an element, click and type. Pins follow their element and are colored by severity.</td>
    <td width="50%"><img src="site/assets/edit-inline.png" alt="Editing a testimonial in place with a word in bold"><br><b>Edit text where it lives.</b> Click any text and type. ⌘B, ⌘I, ⌘U and ⇧⌘X format it; links and markup around it stay put.</td>
  </tr>
  <tr>
    <td width="50%"><img src="site/assets/remove-hover.png" alt="Buttons outlined in red with a Remove label"><br><b>Strike whole sections.</b> Remove hides a section on the spot so you see the page without it. Restore it any time.</td>
    <td width="50%"><img src="site/assets/row-severity.png" alt="A review row with Must fix selected"><br><b>Say how much it matters.</b> Must fix, Suggested, Nit, or Note for things that are good as they are.</td>
  </tr>
</table>

When you're done, **Copy Markdown** and paste it into Claude Code, Cursor, an issue or a PR. Then click **Done** and the page goes back to how it was.

## Install

1. [**Download pagecrit.zip**](https://github.com/aroc/pagecrit/releases/latest/download/pagecrit.zip) from the [latest release](https://github.com/aroc/pagecrit/releases/latest) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the unzipped **`pagecrit`** folder. (Working from a clone? Choose its `extension` folder instead.)
3. Pin **PageCrit** to the toolbar.
4. Open the page you want to review and click the icon, or press **Alt+Shift+N**. The panel opens right away. If a page can't be reviewed, the icon shows a red **!** and its tooltip says why.

To update, download the new release and load it the same way. From a clone, pull and click **Reload** on the extension in `chrome://extensions`, then refresh the page.

## Using it

Browsing is the default. Turn a tool on, use it, and turn it off with the same key or **Esc**.

| Tool | Key | What it does |
|---|---|---|
| **Pin** | `P` | **Pin to element** follows the element you click (hover shows its outline and tag). **Pin to page** stays at that spot in the page content, including inside scrolling containers. |
| **Edit text** | `E` | Type directly on the page. ⌘/Ctrl+A selects just the clicked run of text. Enter saves, Shift+Enter adds a line break, Esc cancels, ⌘/Ctrl+Z undoes, clicking elsewhere saves. |
| **Remove** | `R` | Hover to outline a section in red, click to hide it. Restore it from the panel. |
| **Copy Markdown** | `C` | Puts the review on the clipboard. **Download** saves the same Markdown as `2026-10-24 14-05 Page title.md`. |

- **Severity:** every item has **Must fix** (red), **Suggested** (orange, the default), **Nit** (yellow) and **Note** (blue, no change needed). Pins take the color; the review lists urgent items first and notes last.
- **The panel:** click a pin to highlight its note, or click a note to scroll to its pin. Drag the header (or the minimized pill) anywhere; the corner button snaps it back to a corner.
- **Done** appears after you copy or download, and closes the review in one click. If you change anything afterwards, it hides until you copy or download again, so unsent feedback is never thrown away.
- **Recent reviews:** when the current review is empty, a **Recent reviews** link opens your last 10 copied or downloaded reviews, even after Done or a browser restart. Open one to read the whole review, then copy or download its Markdown again (pins don't come back). Delete reviews one at a time or all at once; each asks once in place.
- **Reloads and navigation:** the review lives with its tab. Refresh or click through the site and your pins come back; each page you visit becomes P1, P2… in the same review. On a different site, click the icon to continue it. Chrome's session storage keeps the draft until you close the tab, discard the review or quit the browser.

## What your agent gets

One short Markdown file. A header with the page, timing and environment, a "How to address this review" block, then each item with what to change and how to find it in source:

```markdown
### 1. Comment · pin 1 · must fix
- Note: Annual price reads like monthly. Lead with the per-month price.
- Section: main › Plan the week your team actually has. › Pro
- Text: `$96 per seat`
- Context: …Get started Pro **$96 per seat** $8 a month per seat, billed yearly…
- Locator: `div[data-testid="plan-pro"] > div`
- Excerpt: `<div class="price">$96 <small>per seat</small></div>`
```

Text edits give the exact original and replacement (plus formatting and the element's inline markup); removals give the section. There's no full-page HTML, no form values and no action history. See the [full sample](site/assets/sample-review.md) and the [format reference](docs/format.md). Paste it with your source project open:

> Implement the review in this Markdown file in this repository, following its "How to address this review" section.

## Privacy

Nothing is sent anywhere. There's no account and no server. A review in progress stays with its tab. Your last 10 copied or downloaded reviews are kept as Markdown in this browser profile so you can get them back. They are never synced or uploaded, and you can delete them one by one or all at once. The extension only runs on a page after you click its icon or press the shortcut, and it never reads form fields. The Markdown can still quote visible text near an item, plus the page URL with query strings and fragments removed, so read it before sharing.

## Limits

- **Text edits are previews.** They change the page in your tab, not the website or your code. If the site re-renders an edited element, the review keeps your requested change and flags it.
- **Placement is best effort.** Pins use element locators and offsets, which can't be guaranteed after a redesign, at a different viewport, or when the site replaces the element.
- **Main page only.** iframes, Shadow DOM content, PDFs, browser pages and the Chrome Web Store aren't supported, and nor are forms, password fields, existing rich-text editors, canvases or SVG text.
- **Formatting is scoped.** Shortcuts add or remove `<strong>`/`<em>`/`<u>`/`<s>` inside the edited run only, and can't undo formatting the site applied around it.
- **Not a security boundary.** The panel lives in a closed Shadow DOM and only accepts real input, but the site's own scripts can still see live text previews. Use it on pages you trust and don't type secrets into notes.
- **Modal dialogs.** A native modal dialog blocks the panel. Close it before starting or continuing a review.

## Development

```sh
npm ci
npx playwright install chromium
npm test              # unit tests
npm run check         # syntax check
npm run test:browser  # real Chromium: core, UI, limits, worker restart
npm run package       # dist/pagecrit.zip
npm run screenshots   # regenerate the images in site/assets
npm run test:activation  # Linux only: real toolbar click / activeTab test
```

`extension/` is the installable source: plain JavaScript, no build step and no runtime dependencies. Development uses Node 24; packaging also uses Python 3's standard ZIP library. Tests and screenshots use only synthetic local pages (`scripts/demo` is a made-up product page), so never commit a real review.

**Releasing:** bump the version in `extension/manifest.json`, `package.json` and `VERSION` in `extension/content.js`, then push a matching tag (`git tag v0.2.0 && git push origin v0.2.0`). CI runs every test and publishes the release with `pagecrit.zip` attached; the README's download link always points at the latest one.

`site/` is the static landing page at [pagecrit.dev](https://pagecrit.dev) (no build, self-hosted fonts). It's a Cloudflare Worker serving only `site/` (`wrangler.jsonc`); `npm run deploy:site` publishes it (needs `CLOUDFLARE_API_TOKEN`).

More in [architecture](docs/architecture.md), [review format](docs/format.md) and [testing](docs/testing.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
