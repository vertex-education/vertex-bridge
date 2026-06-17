# Demo Scenario Context

## Client

- School/client name: Heritage Summit Schools
- Primary contact: Jack Bauer
- Client type: New VSS charter school client
- Purchased service: SFO only
- Onboarding start date: July 1, 2026

## Demo Story

Heritage Summit Schools is a new SFO-only client. Jack Bauer receives a school invite email, creates an account, and lands in a personalized School Onboarding portal. The portal reads five client-facing SFO onboarding tasks from a dedicated Asana demo project. Jack completes tasks one at a time in a guided journey.

When Jack uploads a file for a task, the file is stored in Cloudflare R2, upload metadata is recorded, the matching Asana task is marked complete, and a completion comment is added to Asana.

## Main Demo Outcome

The demo should prove that a client action in the portal can update Vertex's internal workflow in Asana.

## Demo Pages

- Admin / Setup: send school and Vertex invite emails.
- School Onboarding: Jack's client-facing onboarding journey.
- Vertex Dashboard: internal progress view for Vertex users.
