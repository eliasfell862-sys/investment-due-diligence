# PDF/PPT Evidence Browser Smoke Verification

Date: 2026-07-24 (Asia/Shanghai)

## Environment

- Worktree: linked worktree under `C:\Users\33755\Desktop\<investment-due-diligence-project>\.worktrees\investment-due-diligence-foundation`
- Branch: `feature/investment-due-diligence-foundation`
- Local URL: `http://127.0.0.1:5173/`
- Browser project id: `77b11582-fa7d-4b79-9689-4830b48c8b11`
- Project name: `PDF PPT evidence browser verification` (Chinese UI label)
- Data Room URL: `http://127.0.0.1:5173/projects/77b11582-fa7d-4b79-9689-4830b48c8b11/data-room`

## Input files

| Purpose | Path | SHA-256 |
| --- | --- | --- |
| Text PDF | `C:\Users\33755\AppData\Local\Temp\nebula-analytics-smoke.pdf` | `FB6DC01E7F785EBD0CF54F6C3496F24D6A55227C49A218DB4B9630D4D6E1A0BA` |
| PPTX fixture | `app/src/test/fixtures/minimal-due-diligence.pptx` | `481FC052FCEBABB495249FCD6DB8CD94680068D5DF4BADE652A5B067FD27FE3B` |
| Legacy PPT placeholder | `C:\Users\33755\ppt-placeholder.ppt` | `543D7B1B7492F616E3115A232F9157D4A7FA724B44E067D6BC586660DB35A0EC` |
| Invalid PDF failure input | `C:\Users\33755\broken-smoke.pdf` | `55AB12FBCC4FCB0FB5AC020129703B7D0D28CDE90577AAACC6DF8021A68D3692` |

All files are synthetic and contain no confidential information.

## PDF production-worker path

The PDF was uploaded through the real file chooser and remained listed after upload. The first production-worker attempt exposed a real integration defect: pdf.js emits its internal fake-worker `ready` handshake before the application result, and strict main-thread response validation rejected that handshake as an invalid application response.

The defect was reproduced in a failing regression test, fixed by ignoring only the exact pdf.js handshake envelope, and verified in commit `975083e` (`fix: ignore pdf.js fake-worker handshake`). All other malformed worker responses remain rejected.

After retry, the production Worker extracted five page fragments and produced three candidates:

| Candidate | Value | Locator | Review result |
| --- | --- | --- | --- |
| `business_description` | `Enterprise data platform` | Page 1 / object `Text block 3` | Confirmed |
| `company_name` | `Nebula Analytics` | Page 1 / object `Text block 2` | Confirmed |
| `team_summary` | `Operators and engineers with ten years experience` | Page 1 / object `Text block 4` | Confirmed |

A browser refresh preserved the file, fragments, candidate review states, and formal evidence. The Data Room showed the completed-review status for this PDF.

The Dashboard then showed:

- Quick-look gate: satisfied.
- Formal memorandum gate: blocked.
- Missing formal fields: `revenue` and `gross_margin`.
- Unresolved conflicts: zero.

## PPTX production-worker path

The committed fixture was rebuilt as valid OOXML with separate company/business text shapes and an ASCII speaker note, then uploaded through the real file chooser. The committed fixture is from commit `962e5bb` (`test: add minimal due diligence PPTX fixture`).

Observed source fragments and locators:

- Slide 1 / object `Revenue table` / table 1 / row 1 / column 1: `Year`.
- Slide 1 / object `Revenue table` / table 1 / row 1 / column 2: `Revenue`.
- Slide 1 / object `Revenue table` / table 1 / row 2 / column 1: `2025`.
- Slide 1 / object `Revenue table` / table 1 / row 2 / column 2: `RMB 120 million`.
- Slide 1 / object `Business`: `Business Description: Enterprise data platform`.
- Slide 1 / object `Company`: `Company Name: Nebula Analytics`.
- Slide 2 / object `Speaker notes`: `Forecast: 2026 ARR: RMB 200 million`.
- Slide 2 / object `Team`: `TEAM: Operators and engineers with ten years experience`.

The fixed fixture produced three deterministic candidates: business description, company name, and team summary.

Review behavior:

- Submitting a correction without a reason was blocked with the Chinese required-reason alert.
- Business description was corrected to `Enterprise data and AI platform` with reason `Normalize business description for browser smoke verification.` and generated formal evidence.
- Submitting a rejection without a reason was blocked with the Chinese required-reason alert.
- Team summary was rejected with reason `Team statement is too generic for formal evidence.`.
- Refresh preserved the corrected and rejected states.
- Reparse preserved the same three candidate identities and review states; no duplicate candidate appeared.

An earlier 5.6 KiB draft fixture was also uploaded during fixture diagnosis. It remains only in this local smoke project and explains the extra pending-candidate count visible later in the Dashboard; it is not the committed fixture.

## Failure and fallback paths

- Uploading `ppt-placeholder.ppt` displayed the Chinese `Save as PPTX` guidance and kept manual entry available.
- Uploading and parsing `broken-smoke.pdf` displayed `PDF could not be loaded.`.
- The invalid PDF remained listed, retry and manual-entry actions remained available, and previously confirmed PDF evidence was unchanged.
- After the injected failure, the Dashboard still reported quick-look satisfied, formal memorandum blocked by revenue and gross margin, and zero unresolved conflicts.

## Console, offline, and network observations

- Page console entries were limited to Vite connection messages and the React DevTools development hint.
- No application warning or error remained after the pdf.js handshake fix.
- The browser-control API available in this run did not expose request-level network logs, so the real-browser run cannot independently enumerate every request.
- Offline behavior is additionally covered by the integration suite, which spies on `fetch` for the PDF/PPT-only flow and expects zero calls.
- The document extraction configuration uses local bundled assets and `useWorkerFetch: false` for PDF extraction.
- One `ab.chatgpt.com` Statsig timeout was emitted by the Chrome-control tooling while claiming the tab. It did not appear in the page console and is not an application request.

## Visual and responsive comparison

Desktop and 820 px viewport screenshots were inspected against the accepted visual baseline:

- 264 px dark navy navigation rail.
- Warm ivory/paper workspace.
- Restrained teal accents and square corners.
- Serif Chinese headings and sans-serif controls.
- Desktop source / preview / candidate review layout.
- Below 900 px, the review regions stack vertically with no horizontal page overflow.
- Active states remain visible and action targets remain usable.

Screenshot artifacts:

- `C:\Users\33755\.codex\visualizations\2026\07\24\019f91b5-bc13-74c2-83aa-0738795cf8c9\pdf-ppt-evidence-desktop-smoke.png`
- `C:\Users\33755\.codex\visualizations\2026\07\24\019f91b5-bc13-74c2-83aa-0738795cf8c9\pdf-ppt-evidence-820px-smoke.png`

`view_image` could not reopen the saved image because the Windows sandbox wrapper rejected linked-worktree/writable-descendant access. The original browser screenshot bytes were emitted and inspected directly instead.

## Final automated verification

Commands:

```powershell
git diff --check
cd app
npm run check
npm run build
npm audit --offline --audit-level=high
```

Observed result:

- 40 test files passed.
- 858 tests passed.
- TypeScript build passed.
- Lint passed.
- Production build passed.
- Offline audit found 0 vulnerabilities.

Non-blocking Vite warning:

- Some minified chunks exceed 500 kB.
- Largest reported outputs included `pdf.worker.min` at 1,298.20 kB, the main index chunk at 774.58 kB, and the document-candidate worker at 767.31 kB.
- This is a bundle-size warning only; the build exited successfully.

## Tooling deviations

- Chrome file chooser automation opened correctly, but `fileChooser.setFiles` returned `Not allowed`. The user selected each synthetic file in the native chooser.
- Windows Computer Use was attempted only for the native chooser fallback, then stopped because it could not determine the current browser URL with sufficient policy confidence. No application action depended on it.
- The linked-worktree sandbox also prevented `apply_patch` and `view_image` from reopening writable descendants. Repository edits were applied as Git patches from the verified worktree, and screenshot inspection used the browser-provided image bytes.
