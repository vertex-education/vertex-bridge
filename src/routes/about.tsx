import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <main className="page-wrap page-shell">
      <div className="page-stack page-stack-standard">
        <div className="page-heading">
          <div className="page-kicker">About</div>
          <h1 className="page-title">
            Vertex Bridge
          </h1>
        </div>

        <section className="island-shell rounded-2xl p-5 sm:p-8">
          <h2 className="mb-3 font-display text-2xl font-bold text-[var(--vertex-blue)]">
            School onboarding, organized.
          </h2>
          <p className="m-0 max-w-3xl text-base leading-8 text-[var(--sea-ink-soft)]">
            Vertex Bridge brings school invites, profile confirmation, uploads, and onboarding status into one operational workspace.
          </p>
        </section>
      </div>
    </main>
  )
}
