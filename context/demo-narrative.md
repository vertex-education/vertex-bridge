# Demo Narrative — VSS Client Onboarding Portal

## The 60-Second Story
"Today, when a new charter school signs with VSS, they land in Asana —
a project management tool that was never built for clients. They see over
100 tasks, no guidance, and no idea where to start. The result is confusion,
mistakes, rework, and missed deadlines for everyone.

We built something different."

---

## Demo Flow (7 Screens / Moments)

### 1. Admin / Setup Page
**What you show:** Admin enters Jack Bauer's email, sends a school invite. Vertex invite option shown.
Backup copyable links available if email is delayed.
**The wow:** "This is how a new client gets in. One action from the Vertex side — and the client
has a real, secure account waiting."

### 2. Invite & Login
**What you show:** Jack opens invite email → creates account → lands on branded VSS portal.
School name and primary contact pre-populated from HubSpot mock.
**The wow:** "We already know who you are. No setup required."

### 3. HubSpot Confirmation Screen
**What you show:** Immediately after first login, Jack sees a pre-populated summary card:

```
  School:   Heritage Summit Schools
  State:    California
  Services: SFO (Accounting, AP, Payroll, Grants)
  Status:   New School
  Your Vertex Contact: [CS Owner Name]
```

Single prompt: "Does this look right?"
Two options: Confirm → proceed to wizard | Something's wrong → notify Vertex admin.

**Why it's in the demo:** Shows judges that the system doesn't blindly trust HubSpot data —
there's a human confirmation gate before any tasks are assigned. This is the governance
checkpoint made visible.
**The line:** "We pulled this from your contract. You confirm it. Then we build your
onboarding around it."

### 4. Service-Tailored Onboarding Wizard
**What you show:** Heritage Summit Schools SFO tasks only — sorted by due date, one at a time.
URGENT tasks at the top. Progress indicator: 0 of 5 complete.
**The wow:** "An SFO client in California sees their tasks. An SPA client sees different ones.
Nobody sees what doesn't apply to them."

### 5. Document Upload → Asana Update
**What you show:** Jack uploads a file (e.g., voided check). Portal confirms upload.
Switch to Asana live: matching task is marked complete, completion comment visible.
**The wow:** "It didn't just save the file. It updated Vertex's internal workflow automatically."

### 6. Embedded AI Helper
**What you show:** Jack opens chat and asks:
- "What do I need to upload for this step?"
- "Why does Vertex need this?"
- "What happens after I upload?"
AI answers in plain language. Guardrail text visible below chat window.
**The wow:** "The AI doesn't advise. It guides. It explains. It reduces the back-and-forth
that costs your team hours every onboarding cycle."

### 7. Vertex Dashboard
**What you show:** Vertex team view — Heritage Summit Schools, 2 of 5 tasks complete,
task list with statuses, last upload activity timestamp.
**The wow:** "Your team no longer hunts through Asana. Everything is organized, routed,
and visible in one place."

---

## Closing Line
"This isn't just a better form. It's a smarter handoff — for the schools we serve,
and for the teams that serve them."

---

## Judging Criteria Mapping
| Criterion | Where it shows in demo |
|---|---|
| Business impact | Pre-populated login, zero rework, Asana automation, Vertex Dashboard |
| Data governance | HubSpot validation gate, confirmation screen, audit trail, field locking |
| Innovation | AI helper + live Asana update triggered by client upload |
| Practicality / scalability | Real Asana integration, internal dashboard, HubSpot pattern for production |
| Effective use of AI | Scoped explanation, FAQ, visible guardrails — no overreach |
| Presentation clarity | Linear story: problem → admin → login → confirm → wizard → upload → Asana → dashboard |
