# Synthetic browser regression

The original five `workspace.spec.ts` cases remain unchanged. `releases.spec.ts`
adds seven R22 cases, each bounded to 60 seconds:

| ID | Browser assertion |
|---|---|
| R22-B01 | A real candidate POST completes; a following GET receives 503; the confirmed ID remains visible and read-only refresh does not send a second POST |
| R22-B02 | Save and validate sends one candidate POST and one build POST; the final replacement confirmation remains separate and cancellation sends no publish POST |
| R22-B03 | Filtered-empty results clear conditions, a truly empty project offers first creation, and snapshot filters do not inherit publication-only conditions |
| R22-B04 | A real dispatched `KeyboardEvent` with `isComposing=true` cannot adopt a title suggestion; plain Tab preserves author-entered text |
| R22-B05 | A delayed real project-B shares response cannot replace project-A sharing after navigation through the UI |
| R22-B06 | DELETE actually returns 204 upstream, then its browser response is cut; GET proves the revoked state with exactly one DELETE and no original token rendered |
| R22-B07 | Unchanged Enter and cancelled Escape return focus to the actual sample cell, preserve its text and create no sample draft or source write |

`release-flows.mjs` contains UI-only steps reusable with the existing CUA adapter.
Network fault interception belongs to the remote Playwright cases; isolated local
CUA acceptance uses its separately managed synthetic proxy. POST/DELETE success is
never fabricated: interception calls `route.fetch()` first. Only the subsequent
read failure or lost browser response is injected.

The `QA_GENERATION=r10` startup calls
`scripts/r22-ui-release-fixture.ts`, guarded to `DemoProvider`. It preserves
`local/ai-safety-ui-qa` and its original 12 rows, adds a three-row B project and an
empty project, seeds current publications and a ready internal snapshot, and
discards one-time share URLs. Tests operate on redacted share listings. They never
read native services, real benchmarks, or production credentials.

This task ran syntax checking and `npm run test:e2e:list` only: **12 tests
discovered in two files**. Actual browser execution and its results must come from
the remote CI run or explicitly recorded isolated CUA acceptance; discovery is not
a browser pass. Existing ZIP download, row-count, system-column and checksum
assertions were preserved.
