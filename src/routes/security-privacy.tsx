import { createFileRoute } from '@tanstack/react-router'
import {
  BrainCircuit,
  Database,
  FileLock2,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react'

export const Route = createFileRoute('/security-privacy')({
  component: SecurityPrivacyPage,
})

const standards = [
  {
    title: 'Authenticated access',
    text: 'Onboarding workspaces, uploads, AI assistance, and internal dashboards require a signed-in Vertex Bridge session. Staff-only areas are restricted to Vertex staff or admin roles.',
    icon: LockKeyhole,
  },
  {
    title: 'Private document handling',
    text: 'Uploaded documents are stored in a private Cloudflare R2 bucket. Document download links use submission IDs, not raw storage keys, and the server verifies the user can access the submission before reading from storage.',
    icon: FileLock2,
  },
  {
    title: 'Encryption in storage and transit',
    text: 'Vertex Bridge uses Cloudflare R2 for file storage and Cloudflare D1 for workflow metadata. These platform services provide encryption at rest, while production traffic is served over HTTPS.',
    icon: Database,
  },
  {
    title: 'Scoped school data',
    text: 'School users are limited to schools assigned to their account. Internal dashboard data, submission review actions, and client profile updates are available only to authorized Vertex staff.',
    icon: ShieldCheck,
  },
  {
    title: 'Safer invites and secrets',
    text: 'Invite links expire, invite tokens are stored as hashes, and application secrets belong in Cloudflare environment secrets rather than client code or repository files.',
    icon: KeyRound,
  },
  {
    title: 'Guardrailed AI assistance',
    text: 'VertexAI is limited to onboarding guidance from approved task and FAQ context. It should not approve documents, provide legal or financial advice, or ask users to type sensitive bank details into chat.',
    icon: BrainCircuit,
  },
]

const fileStandards = [
  'Accepted upload types are limited to common document, spreadsheet, CSV, PNG, and JPG files.',
  'Uploads are size-limited and screened to reject obvious HTML, XML, SVG, and script-like content.',
  'Documents are served as downloads with browser MIME sniffing disabled.',
  'Raw R2 storage keys are kept server-side and are not used as public document URLs.',
]

const privacyStandards = [
  'We collect only the information needed to operate onboarding: account details, school profile fields, task status, upload metadata, and support interactions in the portal.',
  'We use uploaded files and task metadata to route onboarding work, record submission status, and support Vertex review workflows.',
  'We do not ask clients to type bank account numbers, payroll details, or other sensitive document contents into VertexAI chat.',
  'Access to onboarding submissions is limited by role and school assignment.',
]

function SecurityPrivacyPage() {
  return (
    <main className="page-wrap page-shell">
      <div className="page-stack page-stack-wide page-section-gap">
        <div className="page-heading">
          <div className="page-kicker">Security & Privacy</div>
          <h1 className="page-title">
            How Vertex Bridge protects onboarding work
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-[var(--sea-ink-soft)]">
            Vertex Bridge is an MVP, but it is built around a simple operating standard:
            school files, task data, and account workflows should be private by default,
            visible only to the right people, and handled through authenticated server-side controls.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {standards.map((item) => {
            const Icon = item.icon

            return (
              <article key={item.title} className="island-shell rounded-2xl p-5 sm:p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--vertex-blue)] text-white">
                  <Icon size={21} strokeWidth={2.2} aria-hidden="true" />
                </div>
                <h2 className="mb-2 font-display text-lg font-bold text-[var(--vertex-blue)]">
                  {item.title}
                </h2>
                <p className="m-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
                  {item.text}
                </p>
              </article>
            )
          })}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="island-shell rounded-2xl p-5 sm:p-6">
            <h2 className="mb-4 font-display text-xl font-bold text-[var(--vertex-blue)]">
              File Protection Standards
            </h2>
            <ul className="m-0 space-y-3 pl-5 text-sm leading-7 text-[var(--sea-ink-soft)]">
              {fileStandards.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="island-shell rounded-2xl p-5 sm:p-6">
            <h2 className="mb-4 font-display text-xl font-bold text-[var(--vertex-blue)]">
              Privacy Standards
            </h2>
            <ul className="m-0 space-y-3 pl-5 text-sm leading-7 text-[var(--sea-ink-soft)]">
              {privacyStandards.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-3 font-display text-xl font-bold text-[var(--vertex-blue)]">
            Current MVP Boundaries
          </h2>
          <p className="m-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
            This page describes the security and privacy controls currently represented in
            Vertex Bridge. Production expansion should add formal retention schedules,
            audit reporting, malware scanning, incident response procedures, and any
            compliance commitments required by Vertex Education policies or client contracts.
          </p>
        </section>
      </div>
    </main>
  )
}
