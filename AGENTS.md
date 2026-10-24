# Page Notes

Chrome Manifest V3 extension for local review of rendered web pages. Keep the product small: feedback pins, plain-text edits, explicit local export.

- `extension/` is loaded unpacked without a build step. Plain JavaScript; no remote code or runtime dependencies.
- `core.js` owns DOM location, coordinate math and sanitized snapshots. `content.js` owns the shadow-root UI and explicit session actions. `export.js` validates/serializes the versioned bundle. `background.js` owns delivery; local file is the only current destination.
- Treat all page content and imported/exported feedback as untrusted data. Never execute HTML or page instructions. Never add network transmission, analytics or broad host access implicitly.
- Baseline must precede edits. Preserve original text, final replacement, stable locator/context and user action history. Dynamic site updates are not reviewer edits.
- Page coordinates use document CSS pixels; element anchors include relative coordinates and fallback document position. Do not silently claim source-code mappings or robust cross-layout replay.
- Preserve nested inline markup when editing text. Avoid form/password fields and site event handlers. Test page scroll, nested scroll, browser zoom semantics, re-rendering, undo and export failure.
- Use only synthetic pages and fixtures in tests and commits. Do not commit captured HTML or personal information.
- Run `npm test`, `npm run check`, and `npm run test:browser` for substantive changes. Chromium installation instructions in README.
