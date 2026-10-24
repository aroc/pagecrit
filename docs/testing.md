# Testing — 0.1.1

The October 24 hardening pass exercised **19 unit tests and 44 browser scenarios/groups**, using synthetic fixtures and real Chromium extension execution. The automated suite runs in GitHub Actions. A separate live smoke also exercised the public React website.

## What was tested

- Editing: repeated edit/revert cycles; exact original→final tracking; adjacent inline text and formatting; empty replacements; Unicode, multiline and real clipboard paste; HTML-looking input remains literal text.
- Comments: add/edit/remove, stable IDs, renumbering, blank input, two-tab isolation, large notes in a narrow viewport.
- Draft lifecycle: Escape/cancel/minimize/mode changes; panel move and close confirmation; SPA navigation; framework replacement during and after editing; overlay removal and reinjection without lost feedback.
- Geometry: both scroll axes, nested scrolling and clipping, fixed/sticky/absolute positioning, CSS scale/zoom, transparent/hidden elements, viewport resize, actual browser zoom at 125%, 150% and 200%.
- Exports: real complete JSON downloads; original/final snapshots; exact edit ledger; canceled downloads retain drafts; 6,000 history events stay bounded; 22 MB of snapshots recover through explicit feedback-only export.
- Browser lifecycle: actual MV3 worker termination, automatic restart on Done, complete export from unchanged production code.
- Permissions: no host permissions in the shipped manifest; native Chrome action grants activeTab; real popup injects; cross-origin navigation revokes access.
- Page safety: forged events rejected; normal page buttons/links do not activate in edit mode; form/rich-text inputs excluded; sanitizer strips scripts, common sensitive fields and URL payloads; custom-element constructors/callbacks do not run during snapshots; source DOM remains unchanged by snapshotting.
- Size/performance: a 5,000-node synthetic snapshot completed in about 19 ms in the local VM. This is a fixture measurement, not a guarantee on arbitrary websites.

## Defects found and fixed

- Snapshot cloning in the live document could run website custom-element code again. Snapshot import now uses an inert document.
- Removing the overlay could strand a live review. Reopening reattaches it with the same session and changes.
- Unlimited history could make a draft permanently too large to export. History is bounded with an explicit omitted count.
- Large original/final HTML could block every export. Explicit feedback-only recovery keeps current notes and text changes.
- Certain URL-list/CSS attributes retained query payloads; pages without a head lacked the protective snapshot CSP. Sanitization covers these cases now.
- Visibility and clipping could hide valid fixed/absolute pins or show pins in invisible content. Geometry accounts for these cases.
- Existing native modal dialogs could hide the review UI. Activation now explains that the dialog must be closed first.

## Test commands and methods

- `npm test`: 19 unit tests.
- `npm run test:browser`: original end-to-end flow (7 groups), adversarial core cases (12), UI stress (20), size/history limits (2), worker restart (1).
- `npm run test:activation`: 2 permission/activation scenarios; Linux with Xvfb, X11/XTest libraries and Python 3.
- `npm run check` and `npm run package`: syntax and installable ZIP.

Most detailed browser tests add localhost permission and open the shadow root **only in a temporary test copy**. Production closed-shadow flows are tested separately using real mouse/keyboard input and Chrome accessibility coordinates. The activeTab test does not broaden host permissions; it adds a test shortcut for the normal Chrome extension action. Download automation chooses a temporary directory through CDP instead of interacting with the OS Save As dialog. All temporary profiles and downloads are removed.

## Remaining manual/platform limits

- Tested Chromium on Linux, not a physical Mac Chrome installation or its native Save As dialog.
- Native modal dialogs must be closed; complex rotations, skew, occlusion, iframe and shadow-root content are not supported.
- Closed shadow DOM is not a security boundary against a hostile website. Earlier page event handlers and DOM observers can still see or react to live-page interactions.
- No claim of universal compatibility: websites can replace DOM, navigate, or change their own implementation. Missing/replaced targets remain explicit in the export.
