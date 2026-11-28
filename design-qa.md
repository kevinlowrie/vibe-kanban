# Project board QA

## Result

The Project board component passed local Playwright interaction QA at desktop
(1440 × 1000) and mobile (390 × 844) sizes. The authenticated project route was
not exercised: this environment has no Rust toolchain, so the local API server
could not be started. The captures use a temporary Vite harness to render the
actual `ProjectBoardPoc` component with its local example API adapter.

## Steps and findings

1. **Open the board — healthy.** The project name, example-data notice, task
   stages, selected task, and timeline render. The review stage now fits without
   truncation. See `artifacts/project-board-qa/01-board-default.png`.
2. **Select a task — healthy.** Selecting an idea updates the details panel and
   highlights its row and bar in the project timeline. See
   `artifacts/project-board-qa/02-selected-task.png`.
3. **Search and run a check — healthy.** Search updates visible task cards and
   explains when the selected task is outside the filtered results. Running the
   example check updates the task and its automated-check process projection.
   See `artifacts/project-board-qa/03-check-complete.png`.
4. **Use the board on mobile — healthy with horizontal scrolling.** Both the
   task stages and timeline remain in their own scroll areas. They are
   keyboard-focusable and have screen-reader labels; visible sideways-scroll
   hints explain how to see the remaining content. See
   `artifacts/project-board-qa/04-mobile.png`.

## Evidence and limits

- Playwright exercised task selection, timeline selection, search, the check
  action, and the mobile scroll-area semantics. The run reported no browser
  page errors and no document-wide horizontal overflow.
- All 15 workflow boundary tests passed, including prerequisite checks,
  idempotent action replay, check-before-review, and human approval.
- Screenshots were saved and visually inspected from this QA run.
- The checks use the local example adapter. They do not establish live Pclip or
  n8n connectivity, server-side workflow enforcement, full accessibility
  conformance, or correct routing through the authenticated app shell.
