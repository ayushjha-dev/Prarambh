# Admin participant controls and focused exam layout

## What will change
- Add **Reset exam** and **Delete participant** actions to each participant’s admin detail panel, with clear confirmation prompts.
- Reset will return a participant to a fresh, not-started attempt and remove their saved answers and result.
- Delete will permanently remove the participant and their related answers/result.
- Keep both actions admin-only and refresh the dashboard immediately after success.
- Make the exam workspace fill the viewport beneath its header and keep full-screen enforcement.
- Move the question palette into a three-line menu at the top-right on every screen size; selecting a question closes it.
- Remove all mark-for-review state, controls, and palette styling.
- Show **Submit Test** only when the candidate is viewing the final question.
- Add a subtle repeating **DEVNEST** watermark across the exam workspace without reducing question readability.

## Technical details
- Add two authenticated, role-checked server functions for reset and delete operations.
- Use privileged database writes only after the existing server-side admin check.
- Rely on existing cascading relationships where available; explicitly clear dependent records in safe order where needed.
- Update exam page state and layout only; timing, autosave, scoring, violations, and resumable behavior remain unchanged.
- Verify the app build and exercise the updated admin actions and exam menu in the browser.
