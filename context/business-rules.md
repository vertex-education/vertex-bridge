# Business Rules — VSS Client Onboarding Portal

## Rule 1: Client Personalization via HubSpot (Critical)
The portal does NOT ask clients to self-identify their state, service type, or new/existing status.
All personalization data is pulled automatically from HubSpot at login.

**Data pulled from HubSpot:**
- School name and primary contact
- State (determines state-specific task visibility)
- Contracted services: SFO, SPA, and/or Additional
- New vs. Existing school status
- Contract start date / onboarding deadline

For the demo: hardcoded mock payload for Heritage Summit Schools.

## Rule 2: Task Filtering Logic (Production)
Tasks shown to the client are filtered by the intersection of:
1. Functional area (matches contracted services)
2. New vs. Existing (matches school status from HubSpot)
3. State (matches state from HubSpot contract)
4. Client-facing flag (internal Vertex tasks never shown)

For the demo: one dedicated Asana project; every task in the project is client-facing.

## Rule 3: URGENT Tasks Surface First
Tasks tagged URGENT (Payroll) must be presented as the first priority step in the wizard,
clearly flagged as time-sensitive.

## Rule 4: Functional Area = Internal Routing
When a client submits a task, it is automatically routed to the correct Vertex internal team
based on the task's Functional Area tag. For the demo: all uploads trigger Asana completion.

## Rule 5: Rework Prevention
Before a submission is finalized, the AI agent reviews the input for completeness and format
and prompts the client to correct issues — reducing back-and-forth with internal teams.

## Rule 6: Task Completion Rules
1. Tasks identified as file upload tasks require a file upload before completion.
2. Upload success marks the portal step complete.
3. Upload success immediately marks the matching Asana task complete.
4. Upload success adds a completion comment to the matching Asana task.
5. The portal must NOT mark the Asana task complete if the file upload fails.

## Rule 7: Internal Dashboard — Columns and Actions

**Columns displayed per client row:**
- School Name
- State
- Client Type (New / Existing)
- Service Package (SFO / SPA / Additional)
- Assigned CS Owner
- Onboarding Start Date
- Overall Progress (% complete — e.g., 2 of 5 tasks)
- Last Activity (date/time of most recent client action)
- Outstanding Tasks (count)
- Routing Alerts (flag if any submission is unreviewed >48hrs)

**Actions available per row:**
- View full task list and completion status
- View submitted documents (read-only)
- Mark a routed submission as Reviewed
- Send a nudge email to the client (templated)
- Correct client profile data before onboarding is finalized

**Access control:**
- Vertex admins see all clients
- Team members (AP, Payroll, Accounting, etc.) see only submissions routed to their area
- Clients never have access to this view
- For demo: Vertex Dashboard is read-only

## Rule 8: Arizona (AZ) — Scoped Out of MVP
Arizona has no state-specific tasks in the Asana onboarding template. AZ clients receive
the All States task set only. Action before production launch: requirements conversation
with SFO team to identify AZ-specific tasks. For the demo: AZ removed from state list.
Demo client (Heritage Summit Schools) is CA — no AZ exposure.

## Rule 9: Demo Scope
1. MVP supports one demo client only: Heritage Summit Schools.
2. MVP supports one service package only: SFO.
3. MVP uses mocked HubSpot data.
4. MVP uses one dedicated Asana demo project.
5. Every task in the demo Asana project is client-facing.
6. Portal does not pull tasks from any live operational Asana project.
