# Authentication — VSS Client Onboarding Portal

## Auth Library
**Better Auth** (betterauth.dev) — modern authentication library

## Login Flow
1. Deal closes in HubSpot → portal auto-provisions client account (email stored, no password yet)
2. Vertex sends client a **magic link** (time-limited, single-use URL) via Better Auth
3. Client clicks magic link → lands on portal → **forced to create their own password** on first visit
4. After password is set, client uses email + password for all future logins
5. Client lands directly on their personalized onboarding dashboard

## Why This Approach
- No "create an account" friction — client is already expected
- Magic link = secure delivery without exposing credentials
- Client owns their password from day one
- Professional first impression: "We were ready for you"

## Security Notes
- Magic links should be time-limited (e.g., 48–72 hours)
- Expired links should trigger a simple "request a new link" flow
- For hackathon demo: can simulate the magic link step by navigating directly to the portal
