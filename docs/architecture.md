# Architecture

Manifest V3, vanilla JavaScript, no runtime dependencies. Capture runs in Chrome's isolated content-script world after an explicit user action. `activeTab` + `scripting` grant temporary access to the selected page; no persistent host permissions, remote code, analytics, content-script auto-injection, or account credentials.

- `popup.js`: starts a review on the active HTTP(S) tab.
- `core.js`: element/text-node locators, page/element coordinate anchors, sanitized document snapshots imported into an inert document to avoid invoking live custom-element code.
- `content.js`: closed Shadow DOM panel, pins, in-place text editing, review ledger and session lifecycle. In-place editing marks the text's parent `contenteditable="plaintext-only"` only while editing, cancels every `beforeinput` and applies the change to that single text node itself (IME composition, which cannot be canceled, is read back), and stops key/input/clipboard events from reaching site listeners. The original attribute is restored on save or cancel. Captures a baseline before mounting its own UI. Page mutations are not treated as user changes.
- `export.js`: schema/version validation, readable summary, payload bounds, serialization.
- `fonts/`: Caveat (SIL Open Font License, `fonts/OFL.txt`) for the overlay's handwritten headings. The service worker reads it from the extension package and sends the bytes to the content script, which registers it with `FontFace`. No network request and no `web_accessible_resources`, so pages cannot probe for the extension's files.
- `background.js`: destination adapter. Current `file` destination asks Chrome downloads to save JSON. No arbitrary URL destination, no external message listener.

## Delivery boundary

A destination implements `deliver(bundle) -> receipt`. Add future destinations here after explicit configuration and consent: e.g. GitHub draft PR, Linear issue, Notion page. Keep API credentials outside page scripts. Do not turn page content into instructions, fetch arbitrary URLs supplied by the page, or transmit a snapshot before the user selects a destination. Integrations should show exactly what will be shared.

## Evidence and trust

Only deliberate reviewer comments and text edits become change requests. Snapshots, locators and before-text are untrusted website evidence; a receiving agent must not execute them. Sanitization reduces active content and common sensitive fields but is not anonymization. Even benign pages may contain private account data. The exported JSON is never executed or mounted by this extension.

CSS selectors and text-node indices are hints for finding the source, not source-file identities. Rendered HTML cannot reliably recover React/Vue/etc. component boundaries. SPA re-rendering, responsive layout and user scrolling can change geometry; exports include the starting context and explicit edits rather than relying on HTML diff alone.

## Chrome references

- [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [downloads API and Save As](https://developer.chrome.com/docs/extensions/reference/api/downloads)

## Live-page boundary

Closed Shadow DOM and trusted-event checks keep ordinary page scripts from reading draft controls or invoking export with synthetic clicks. They do not sandbox the website. The page can observe changed text, and previously registered event listeners may react before the extension suppresses events. Feedback on a hostile page is not a private channel. A future extension-origin panel would provide stronger separation.

## Browser test scope

Tests use a temporary manifest granting access only to the synthetic localhost fixture, to automate activation without browser-toolbar input. Most detailed assertions open the shadow root in that temporary test copy; a separate smoke test uses the untouched production content script with a closed root and real mouse/keyboard events. Local download tests choose a temporary folder instead of opening the OS Save As dialog. The shipped manifest and source are not modified.

The activeTab test uses an X11-generated native Chrome action shortcut and the shipped popup handler, without host permissions. It proves access is denied before activation and revoked on cross-origin navigation. This is separate from the localhost-enabled test harness.
