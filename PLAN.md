# PLAN.md — VSS AI-Guided Client Onboarding Portal
**Vertex AI Innovation Lab | June 16–17, 2026**
**Team:** R.E.M. Sleep — Roger C., Eugene B., Matt L.
**Division:** VSS (Vertex Support Services)
**Build tool:** Cloudflare stack + Claude API + Asana API

---

## Build Gate

Do not begin building until a floater reviews this plan and Roger explicitly says:
**"A floater green-lit my plan."**

---

## The Problem

When a new charter school signs with VSS, they are dropped into Asana — a project management
tool never designed for client-facing onboarding. They see 100+ undifferentiated tasks, no
guidance on why each one matters, and no way to know what applies to them. Internal Vertex
teams then manually hunt across Asana, file folders, and email to find what clients submitted.
Mistakes are caught after submission, creating rework loops and missed deadlines on both sides.

The demo focuses on a new SFO-only client. The client sees only the onboarding steps relevant
to SFO and has a simple, guided way to complete them. Vertex sees progress through a live Asana
integration and an internal dashboard.

---

## Demo Thesis

A closed HubSpot deal can become a guided, AI-supported client onboarding journey that updates
Vertex's internal Asana workflow automatically — with no manual tracking required.

**The key demo moment:**
> Jack Bauer uploads a required file in the School Onboarding portal. The file is stored in
> Cloudflare R2. The matching Asana task is marked complete and receives a completion comment.
> The Vertex Dashboard updates to show progress.

---

## Who It Is For

| User | Role |
|---|---|
| New VSS Charter School Clients (SFO) | Primary — complete their onboarding journey |
| Vertex Internal Teams | Secondary — receive organized, routed submissions |
| Vertex as an Organization | Tertiary — scalable, professional client experience |

**Demo client:**
- School: Heritage Summit Schools
- Primary contact: Jack Bauer
- Service package: SFO only
- Client type: New VSS charter school client
- Onboarding start date: July 1, 2026

---

## The Solution

A web-based client onboarding portal that gives new VSS charter school clients a single,
secure place to complete their onboarding journey — a step-by-step wizard that guides
the client from start to completion, personalized automatically from their HubSpot contract
and contact data, with an embedded AI helper and live Asana integration.

---

## How It Works

### Personalization Engine
All client personalization is pulled from HubSpot at login — no client self-identification
required. The portal reads: school name, primary contact, state, contracted services,
new vs. existing status, and onboarding start date. For the demo, this is a hardcoded
mock payload for Heritage Summit Schools.

### Login Flow
1. Deal closes in HubSpot → Vertex admin sends invite from Admin/Setup page
2. Client receives invite email (real email via Cloudflare Workers)
3. Client clicks link → creates password via Better Auth
4. Client lands on branded portal — name and school pre-populated
5. **HubSpot Confirmation Screen** — client confirms pre-populated profile before tasks load

### The Wizard
Tasks drawn from a dedicated Asana demo project (Heritage Summit Schools - SFO Onboarding),
sorted by due date, displayed one at a time. In production, the full 117-task inventory
is filtered per client by functional area, new/existing status, state, and client-facing flag.
URGENT (Payroll) tasks always surface first.

### The AI Helper
Embedded chat agent with three jobs:
1. **Explanation** — "What do I need to upload?" / "Why does Vertex need this?"
2. **Validation** — reviews submissions for completeness before finalization
3. **FAQ** — approved answers about SFO onboarding, personalized with Jack / Heritage Summit Schools

**AI guardrails:** Guide and clarify only. No financial, legal, or compliance advice.
No routing or approval decisions. Guardrail text shown visibly to clients at all times.

### Internal Routing
Upload success → R2 file stored → D1 metadata recorded → Asana task completed →
completion comment added → Vertex Dashboard updated. No manual sorting required.

---

## Data Governance

The portal enforces governance at four points. First, HubSpot field validation: the deal
trigger only fires if school name, state, contracted services, and client type are all
present and non-null — incomplete records return an error to the Vertex admin before a
workspace is created. Second, data ownership is explicit at every handoff: Sales owns
HubSpot accuracy at deal close, CS owns the client workspace and confirmation screen,
the client owns their own submissions, and each internal team owns the intake records
routed to them. Third, every submission, upload, routing action, and AI interaction is
logged with a timestamp, user ID, and action type — creating a full audit trail accessible
to Vertex admins. Fourth, field definitions are locked across systems: "Contracted Services"
means the same thing in HubSpot, the portal task filter, and the Snowflake onboarding_tasks
table — no translation layer, no drift.

---

## Data & Technology

| Layer | Tool |
|---|---|
| Frontend / app | Web app deployed on Cloudflare |
| Backend / API | Cloudflare Worker |
| Authentication | Better Auth — magic link + forced password on first login |
| Database | Cloudflare D1 |
| File storage | Cloudflare R2 (encrypted at rest) |
| Email | Cloudflare email sending from Workers |
| Task system | Asana API — dedicated demo project |
| AI agent | Claude API — claude-sonnet-4-6 |
| Client data source | HubSpot API (mocked for demo) |
| Secrets | Cloudflare environment variables / secrets store |

**Demo data:** All demo data is simulated. Mock client: Heritage Summit Schools, CA, New, SFO.
No real client data or documents used.

---

## Risks & How We Handle Them

| Risk | Mitigation |
|---|---|
| PII and sensitive financial data | Role-based access; R2 encryption at rest; HTTPS in transit |
| FERPA compliance (SPA) | Scoped to SFO for MVP; FERPA addressed in future SPA phase |
| Wrong document uploaded | AI flags before submission; human review gate before data ingestion |
| Multi-service routing overlap | Routing tied explicitly to Functional Area tag per task |
| Client doesn't finish | Save state on every step; re-engagement email flow |
| Services change mid-onboarding | Amendment flow preserves progress; adds/removes tasks without reset |
| HubSpot data stale/wrong | Confirmation screen at first login; Vertex admin can correct |
| AI gives compliance advice | Hard guardrails — guide only; visible disclaimer shown to clients |
| Routing rules built incorrectly | Pre-build workshop with each internal team to validate |
| Workflows go stale | Designate platform owner; admin interface for updates (future phase) |
| Asana fetch fails | Fallback static task data; real integration attempted first |
| R2 upload fails | Do not mark Asana task complete; show retry message |
| Email delivery fails | Backup copyable invite links on Admin/Setup page |
| AI API fails | Static FAQ fallback shown to client |

---

## MVP Scope for 12-Hour Build

### Must-Have Features
1. Real authentication via Better Auth
2. Role-based account creation through invite links
3. Admin/Setup page — sends school and Vertex invite emails; backup invite links
4. Real email sending via Cloudflare Workers
5. School Onboarding page — client-facing guided journey
6. Vertex Dashboard — read-only internal progress view
7. Portal reads all tasks from dedicated Asana demo project
8. Tasks sorted by due date; name, notes, due date, status shown
9. Journey view (one task at a time) + all-tasks view
10. File upload for all five SFO demo tasks
11. Real file storage in Cloudflare R2
12. Upload metadata stored in Cloudflare D1
13. Upload success → Asana task marked complete + completion comment added
14. Vertex Dashboard reflects updated task status
15. Warm AI helper — current task context + approved FAQ
16. Visible AI guardrail text on every AI interaction

### Mocked or Simplified for Demo
1. HubSpot data is a hardcoded mock payload
2. One client only: Heritage Summit Schools
3. One service package only: SFO
4. One dedicated Asana demo project
5. Every task in the demo project is client-facing
6. Document review, approval, rejection, resubmission not built
7. Full multi-client routing, notifications, audit exports not built
8. Production-grade security review not completed during hackathon

---

## Demo Flow (7 Screens)

1. **Admin/Setup** — Admin sends school invite to Jack. Backup link shown.
   *"This is how a new client gets in."*

2. **Invite & Login** — Jack opens email, creates account, lands on branded portal.
   *"We already know who you are. No setup required."*

3. **HubSpot Confirmation Screen** — Jack confirms pre-populated school/service summary.
   *"We pulled this from your contract. You confirm it. Then we build your onboarding around it."*
   *(Governance checkpoint — visible to judges.)*

4. **Service-Tailored Wizard** — SFO tasks only, sorted by due date, one at a time.
   *"Nobody sees what doesn't apply to them."*

5. **Document Upload → Asana Update** — Jack uploads file → R2 → Asana task completed → comment added.
   *"It didn't just save the file. It updated Vertex's workflow automatically."*

6. **AI Helper** — Jack asks questions; AI explains in plain language; guardrail visible.
   *"The AI doesn't advise. It guides."*

7. **Vertex Dashboard** — Heritage Summit Schools progress, task list, last activity.
   *"Your team no longer hunts through Asana."*

**Closing line:**
> "This isn't just a better form. It's a smarter handoff — for the schools we serve,
> and for the teams that serve them."

---

## Build Order (After Floater Green-Light)

1. Create Asana demo project: Heritage Summit Schools - SFO Onboarding (5 tasks, due dates set)
2. Set up Cloudflare project, D1, R2, secrets
3. Add Better Auth — account creation and sessions
4. Add invite model and role assignment (school_user, vertex_user, admin)
5. Build Admin/Setup page — invite emails + backup links
6. Implement Cloudflare email sending
7. Add role-protected routes
8. Build mock HubSpot payload + HubSpot Confirmation Screen
9. Implement Asana task fetch — sort by due date
10. Build School Onboarding wizard — step journey + all-tasks view
11. Add R2 file upload tied to Asana task
12. Store upload metadata in D1
13. On upload success — complete Asana task + add comment
14. Build read-only Vertex Dashboard
15. Add AI helper (Claude API) — task context + FAQ
16. Add visible AI guardrail text
17. Test full end-to-end demo path
18. Prepare fallback paths (email/Asana/AI/upload failures)
19. Polish — branding, loading states, mobile, confirmation copy

---

## Testing Plan

### Critical Path
1. Admin sends invite → Jack creates account → assigned school_user
2. Jack lands on School Onboarding (not Vertex Dashboard)
3. Portal loads 5 tasks from Asana sorted by due date
4. Jack uploads file → R2 → D1 → Asana task complete → comment added
5. Vertex Dashboard shows updated progress

### Role Tests
- school_user cannot access Vertex Dashboard
- vertex_user can access Vertex Dashboard, cannot complete tasks as Jack
- admin can access Admin/Setup

### AI Tests
- AI explains current task using task name and notes
- AI answers approved FAQ question
- AI refuses/redirects legal, financial, compliance requests
- AI uses warm tone, personalizes with Jack / Heritage Summit Schools

### Failure Tests
- Asana fetch fails → show helpful error, use fallback tasks
- Email fails → display backup invite link
- Upload fails → do not complete Asana task; show retry message
- AI fails → show static FAQ fallback

---

## Judging Criteria Mapping

| Criterion | Where It Shows |
|---|---|
| Business impact | Pre-populated login, zero rework, Asana automation, Vertex Dashboard |
| Data governance | HubSpot validation, confirmation screen, audit trail, field definition locking |
| Innovation | AI helper + live Asana update triggered by client action |
| Practicality / scalability | Real Asana integration, internal dashboard, HubSpot pattern for production |
| Effective use of AI | Scoped explanation, FAQ, visible guardrails — no overreach |
| Presentation clarity | Linear: problem → admin → login → confirm → wizard → upload → Asana → dashboard |

---

## Non-MVP / Future-State Features
*(Describe in pitch, do not build)*

- Live HubSpot integration
- Multi-client onboarding workspaces
- Multi-service routing (SFO, SPA, Additional → different Vertex teams)
- Document review, rejection, and resubmission workflows
- Amendment flow for mid-onboarding service changes
- Exportable audit logs and retention policies
- Automated reminders and overdue notifications
- Reporting: completion rate, time to onboard, bottlenecks, missing documents
- AI triage agent for free-text problem classification across 9 service lines
- Full Snowflake schema for onboarding_tasks, triage_submissions, routing_log

---

## Context Files

| File | Contents |
|---|---|
| `context/business-rules.md` | Scope rules, task rules, role rules, dashboard spec, AZ gap note |
| `context/asana-integration.md` | Demo project setup, task loading, completion logic, failure rules |
| `context/auth.md` | Better Auth setup, magic link, first-login password, role assignment |
| `context/demo-data.md` | Mock client record, roles, page routes, R2 key pattern |
| `context/demo-scenario.md` | Full demo story and screen-by-screen narrative |
| `context/demo-narrative.md` | Judge-facing demo script with wow moments and criteria mapping |
| `context/ai-helper.md` | AI role, tone, personalization, allowed sources, guardrails |
| `context/faq.md` | Approved FAQ answers for AI helper |
| `context/recommended-sfo-tasks.md` | 5 Asana demo tasks with notes and display rules |
| `context/security-and-compliance.md` | Encryption, access control, secrets, production gaps |
| `context/style-and-tone.md` | Writing principles, sample copy, error message style |
| `context/workflow.md` | Current broken workflow vs. improved demo workflow |
| `context/risks.md` | Full risk register with mitigations and AI guardrails |
| `context/asana-task-inventory.md` | All 117 production onboarding tasks with filtering metadata |

---

## Definition of Done for Demo

- School user creates account through a real invite email
- School user sees personalized School Onboarding for Heritage Summit Schools
- Page reads 5 tasks from dedicated Asana demo project, sorted by due date
- User uploads file → stored in R2 → Asana task marked complete → comment added
- Vertex Dashboard shows updated progress
- AI helper answers task/FAQ questions with visible guardrails
- HubSpot Confirmation Screen shown before tasks load

---

## Success Looks Like

A judge watches the demo and says:
> *"If Vertex could invest in only one of these ideas tomorrow, this one creates the greatest value."*

Because it solves a real, painful problem. It's right-sized for 12 hours. It shows a new
way of working — not just a chatbot, but a system that routes, validates, personalizes, and
scales. And it serves the schools that serve students.
