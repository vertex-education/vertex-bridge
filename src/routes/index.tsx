import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Mail,
  MessageCircle,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'

export const Route = createFileRoute('/')({
  component: IndexPage,
})

const journeySteps = [
  {
    eyebrow: 'Step 1',
    title: 'Start from the invite',
    text: 'Use the email Vertex sent to open your school workspace. Your school details are already waiting.',
    icon: Mail,
  },
  {
    eyebrow: 'Step 2',
    title: 'Confirm the basics',
    text: 'Review your school, services, and Vertex contact before onboarding tasks are assigned.',
    icon: ShieldCheck,
  },
  {
    eyebrow: 'Step 3',
    title: 'Complete the next request',
    text: 'Upload only the documents needed for your services, with due dates and accepted files shown clearly.',
    icon: UploadCloud,
  },
  {
    eyebrow: 'Step 4',
    title: 'Ask when something is unclear',
    text: 'Get plain-language help in the flow without leaving the task or searching through a project board.',
    icon: MessageCircle,
  },
]

function IndexPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [activeStep, setActiveStep] = useState(0)
  const activeJourneyStep = journeySteps[activeStep]
  const ActiveIcon = activeJourneyStep.icon

  const continueToLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigate({
      to: '/login',
      search: email.trim() ? { email: email.trim() } : {},
    })
  }

  const moveStep = (direction: -1 | 1) => {
    setActiveStep((current) => (current + direction + journeySteps.length) % journeySteps.length)
  }

  return (
    <main className="page-wrap flex min-h-[calc(100vh-9rem)] items-center py-8 sm:py-10">
      <section className="grid w-full items-center gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rise-in max-w-xl">
          <div className="mb-6 flex items-center gap-4">
            <img
              src="/brand/mountain-blue.svg"
              alt=""
              aria-hidden="true"
              className="h-11 w-auto flex-shrink-0"
            />
            <div>
              <p className="island-kicker mb-1">Vertex Bridge</p>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--vertex-gray)]">
                School onboarding
              </p>
            </div>
          </div>

          <h1 className="display-title max-w-2xl text-3xl font-black leading-[1.08] text-[var(--vertex-blue)] sm:text-5xl">
            A clear path from invite to ready.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[var(--sea-ink-soft)]">
            Confirm your school details, complete the next onboarding request,
            and get help without sorting through internal tools.
          </p>

          <form
            onSubmit={continueToLogin}
            className="mt-8 max-w-lg rounded-2xl border border-[var(--line)] bg-white/90 p-3 shadow-sm"
          >
            <label className="sr-only" htmlFor="school-email">
              School email
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex min-h-12 flex-1 items-center gap-3 rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] px-4">
                <Mail size={18} className="text-[var(--vertex-gray)]" aria-hidden="true" />
                <input
                  id="school-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="school email"
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm font-semibold text-[var(--sea-ink)] outline-none placeholder:text-[var(--vertex-gray)]"
                />
              </div>
              <button
                type="submit"
                className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--vertex-blue)] bg-[var(--vertex-blue)] px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--lagoon-deep)] sm:w-auto"
              >
                Continue
                <ArrowRight size={16} strokeWidth={2.5} />
              </button>
            </div>
          </form>

          <div className="mt-5 flex flex-wrap gap-3 text-sm font-bold text-[var(--sea-ink)]">
            {['Guided setup', 'Secure uploads', 'Plain-language help'].map((item) => (
              <span key={item} className="inline-flex items-center gap-2">
                <CheckCircle2 size={16} className="text-[var(--vertex-gold)]" />
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="island-shell rise-in rounded-2xl bg-white p-5 [animation-delay:120ms] sm:rounded-[1.5rem] sm:p-6">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="island-kicker mb-2">Your Journey</p>
              <h2 className="m-0 font-display text-2xl font-black text-[var(--vertex-blue)]">
                {activeJourneyStep.title}
              </h2>
            </div>
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--vertex-blue)] text-white">
              <ActiveIcon size={22} strokeWidth={2.3} />
            </div>
          </div>

          <p className="m-0 text-xs font-bold uppercase tracking-[0.16em] text-[var(--vertex-gold)]">
            {activeJourneyStep.eyebrow}
          </p>
          <p className="mt-3 min-h-20 text-base leading-7 text-[var(--sea-ink-soft)]">
            {activeJourneyStep.text}
          </p>

          <div className="mt-8 flex items-center justify-between gap-4 border-t border-[var(--line)] pt-5">
            <div className="flex gap-2" aria-label="Journey steps">
              {journeySteps.map((step, index) => (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setActiveStep(index)}
                  aria-label={`Show ${step.title}`}
                  className={`h-2.5 rounded-full transition ${
                    index === activeStep
                      ? 'w-8 bg-[var(--vertex-blue)]'
                      : 'w-2.5 bg-[var(--light-gray)] hover:bg-[var(--vertex-gray)]'
                  }`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => moveStep(-1)}
                aria-label="Previous journey step"
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-[var(--chip-line)] bg-white text-[var(--vertex-blue)] shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-50"
              >
                <ArrowLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => moveStep(1)}
                aria-label="Next journey step"
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-[var(--vertex-blue)] bg-[var(--vertex-blue)] text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--lagoon-deep)]"
              >
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
