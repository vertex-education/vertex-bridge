# Asana Integration Context

## Goal

Use Asana as the source of truth for the five demo onboarding tasks and prove that portal actions can update Asana.

## Demo Project

Project name:

Heritage Summit Schools - SFO Onboarding

Use a dedicated demo project only. Do not update a real operational project.

## Task Loading

The app should:

1. Read all tasks from the dedicated demo project.
2. Treat every task as client-facing.
3. Pull task name, notes/description, due date, completion status, and task ID.
4. Sort tasks by due date before displaying them in the portal.
5. Push tasks without due dates to the bottom.

## Task Completion

When Jack uploads a required file:

1. Confirm the file was successfully stored in Cloudflare R2.
2. Store upload metadata in D1.
3. Mark the matching Asana task complete.
4. Add a completion comment to the Asana task.

Recommended comment format:

Completed by Jack Bauer via client portal on July 1, 2026.

Optional extra comment details if time allows:

- Uploaded file name.
- Upload timestamp.
- Portal task title.

## Failure Rule

If R2 upload fails, do not complete the Asana task.

If Asana update fails after R2 upload succeeds, show a clear error and let the user retry or let the demo owner manually reconcile.

## Fallback

Keep fallback demo task data available if Asana task fetch fails, but the core demo should attempt the real Asana integration first.
