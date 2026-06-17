# Security and Compliance Context

## Data Sensitivity

The app may handle school data, PII, financial information, and uploaded documents such as payroll registers, budgets, bank documents, and accounting reports. Treat uploaded files and task metadata as sensitive by default.

## Encryption Requirement

The app must support encryption at rest and encryption in transit for uploaded files, school data, PII, and financial information.

## Demo Security Requirements

1. Use HTTPS for app access.
2. Store uploaded files in Cloudflare R2.
3. Store app/auth/upload metadata in Cloudflare D1.
4. Use Better Auth for real authentication.
5. Enforce role-based access for school_user, vertex_user, and admin.
6. Use Cloudflare secrets or environment variables for credentials.
7. Do not hardcode API keys, auth secrets, Asana tokens, AI keys, or Cloudflare credentials.
8. Do not use real sensitive client documents in the live demo.
9. Do not expose public R2 object links for sensitive documents.
10. Keep demo data limited to Heritage Summit Schools.

## AI Guardrails

The AI helper can explain onboarding steps and approved FAQ content. It cannot provide legal, financial, tax, payroll, compliance, or contract advice.

## Production Requirements Not Built in MVP

- Detailed audit logs.
- Retention policies.
- Document review and approval status.
- Signed or protected download links.
- Multi-client access controls.
- Service-area-based internal permissions.
- Security review and compliance validation.
