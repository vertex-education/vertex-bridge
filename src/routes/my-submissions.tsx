import { Link, createFileRoute } from '@tanstack/react-router'
import { FileText, Hourglass, ShieldCheck, UploadCloud } from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { BrandedAlert } from '#/components/BrandedAlert'

export const Route = createFileRoute('/my-submissions')({
  component: MySubmissionsPage,
})

const statusPlaceholders = [
  {
    title: 'Submitted',
    detail: 'Files received from your onboarding journey will appear here.',
    icon: UploadCloud,
  },
  {
    title: 'In Review',
    detail: 'Vertex review statuses will be shown after the workflow is connected.',
    icon: Hourglass,
  },
  {
    title: 'Accepted',
    detail: 'Approved files and next-step notes will be listed in this view.',
    icon: ShieldCheck,
  },
]

function MySubmissionsPage() {
  const { data: session } = authClient.useSession()

  if (!session?.user) {
    return (
      <main className="page-wrap page-shell">
        <div className="page-stack page-stack-standard">
          <BrandedAlert variant="warning" title="Sign in required">
            <span>
              Please <Link to="/login" className="font-bold underline text-[var(--vertex-blue)]">sign in</Link> to access your submissions.
            </span>
          </BrandedAlert>
        </div>
      </main>
    )
  }

  return (
    <main className="page-wrap page-shell pb-28">
      <div className="page-stack page-stack-wide page-section-gap">
        <div className="page-heading">
          <div className="page-kicker">Client Files</div>
          <h1 className="page-title">My Submissions</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-[var(--sea-ink-soft)]">
            A client-facing place for onboarding file history, document statuses, and review notes.
            This page is intentionally staged as a skeleton for future development.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-3">
          {statusPlaceholders.map((item) => {
            const Icon = item.icon

            return (
              <article key={item.title} className="island-shell rounded-xl p-5">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--vertex-blue)_10%,white)] text-[var(--vertex-blue)]">
                  <Icon size={21} strokeWidth={2.2} aria-hidden="true" />
                </div>
                <h2 className="font-display text-lg font-bold text-[var(--vertex-blue)]">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm leading-7 text-[var(--sea-ink-soft)]">
                  {item.detail}
                </p>
              </article>
            )
          })}
        </section>

        <section className="island-shell rounded-xl p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                Files
              </div>
              <h2 className="mt-2 font-display text-xl font-bold text-[var(--sea-ink)]">
                Submission history placeholder
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--sea-ink-soft)]">
                Future development can connect this area to uploaded documents, status changes,
                reviewer notes, and secure download actions.
              </p>
            </div>
            <FileText className="hidden text-[var(--vertex-blue)] sm:block" size={44} strokeWidth={1.8} aria-hidden="true" />
          </div>

          <div className="mt-6 rounded-xl border border-dashed border-[var(--chip-line)] bg-[var(--foam)] px-4 py-10 text-center">
            <p className="text-sm font-bold text-[var(--sea-ink)]">No submission data is connected yet.</p>
            <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
              Submitted files and client-facing review statuses will appear here in a later build.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
