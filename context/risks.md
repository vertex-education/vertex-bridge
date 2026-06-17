# Risks & Mitigations — VSS Client Onboarding Portal

## 1. Security & Data Privacy
**Risk:** Platform handles PII and sensitive financial data. SPA clients subject to FERPA. SFO clients subject to financial compliance regulations.
**Mitigations:**
- Role-based access control: clients only see their own data; internal staff only see their service area
- Data encrypted at rest and in transit
- Magic link + forced password creation on first login
- For demo: mock data only, no real client data

## 2. Data Integrity & Routing
**Risk:** Multi-service clients (e.g. SFO + SPA) could have overlapping routing logic; wrong data to wrong team causes downstream problems.
**Risk:** Client uploads wrong/incomplete document (e.g. wrong year payroll register).
**Mitigations:**
- Routing logic tied explicitly to Functional Area tag per task — not guessed
- AI agent reviews submissions before finalizing; flags issues and requests resubmission
- Human review gate: Vertex staff validate before data enters financial/reporting systems
- Clear error messaging: "This doesn't look right — here's what we need instead"

## 3. Client Experience Edge Cases
**Risk:** Client starts onboarding but doesn't finish.
**Mitigation:** Save state on every step; clear resume flow; configurable timeout and re-engagement email

**Risk:** Contracted services change mid- or post-onboarding.
**Mitigation:** Amendment flow that preserves existing progress and adds/removes tasks without resetting completed work

**Risk:** Some charter school admins not comfortable with digital platforms.
**Mitigation:** AI agent uses plain, friendly language; no jargon without explanation; forgiving UX with clear "why" for every step

## 4. Internal & Operational Risks
**Risk:** Internal teams rely on platform without validating inputs; bad data flows into financial systems.
**Mitigation:** Human review gate before data ingestion; AI flags but does not approve

**Risk:** HubSpot data is stale or incorrect at login → broken personalization.
**Mitigation:** Show client a confirmation screen at first login ("Is this information correct?"); allow Vertex admin to correct before onboarding begins

**Risk:** AI agent gives financial, legal, or compliance advice it shouldn't.
**Mitigation:** AI guardrails — agent guides and clarifies only; never interprets regulations or makes compliance decisions; standard disclaimer shown to clients

## 5. Build & Maintenance Risks
**Risk:** Routing rules for each service type require deep requirements conversations with internal teams — skipping leads to incorrect routing.
**Mitigation:** Pre-build workshop with each team to validate task lists and routing logic before building; Asana template is a starting point, not final source of truth

**Risk:** Vertex adds/modifies services and workflows go stale.
**Mitigation:** Designate a platform owner role; build admin interface for updating task lists without code changes (future phase)

---

## AI Guardrails (Critical)
The AI agent's permitted actions:
- ✅ Explain what a task requires and why
- ✅ Review a submission for completeness and formatting
- ✅ Ask clarifying questions to gather better input
- ✅ Transform plain-language narration into structured data
- ✅ Flag potential issues and request resubmission

The AI agent must NEVER:
- ❌ Give financial advice
- ❌ Give legal or compliance advice
- ❌ Interpret regulations on behalf of the school
- ❌ Make routing or approval decisions autonomously
- ❌ Access or display another client's data
