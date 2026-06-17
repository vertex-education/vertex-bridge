# Demo Data Context

## Mocked Client Record

client_name: Heritage Summit Schools
primary_contact_name: Jack Bauer
service_package: SFO only
client_type: New VSS charter school client
onboarding_start_date: 2026-07-01

## Roles

school_user:
  description: School/client user.
  default_landing_page: /school-onboarding

vertex_user:
  description: Vertex internal user.
  default_landing_page: /vertex-dashboard

admin:
  description: Admin/demo setup user.
  default_landing_page: /admin

## Pages

/admin:
  name: Admin / Setup
  purpose: Send role-based invite emails and provide backup invite links.

/school-onboarding:
  name: School Onboarding
  purpose: Client-facing guided onboarding journey.

/vertex-dashboard:
  name: Vertex Dashboard
  purpose: Internal read-only progress dashboard.

## Completion Comment Template

Completed by {contact_name} via client portal on {date}.

Demo value:

Completed by Jack Bauer via client portal on July 1, 2026.

## R2 Key Pattern

heritage-summit-schools/{asana-task-id}/{timestamp}-{safe-filename}
