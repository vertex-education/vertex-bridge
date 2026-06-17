import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Mail,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react'

export const Route = createFileRoute('/')({
  component: IndexPage,
})

const journeySteps = [
  {
    eyebrow: 'Step 1',
    title: 'Start from the invite',
    text: 'Open the workspace Vertex prepared for your school.',
    detailedText: 'Your onboarding begins with a secure invitation email from Vertex Education. By entering your school email address, you\'ll be routed directly to your dedicated workspace where your team and Vertex specialists are already aligned.',
    tip: 'Check your inbox for the official invitation link, or enter your email above to check active invites.',
    icon: Mail,
  },
  {
    eyebrow: 'Step 2',
    title: 'Confirm the basics',
    text: 'Review your school profile, services, and Vertex contact.',
    detailedText: 'Once inside, verify your school profile information, active integration services, and key contacts. This ensures we are building on the correct foundation from day one.',
    tip: 'Make sure your school\'s tax details and legal name match your official documents.',
    icon: ShieldCheck,
  },
  {
    eyebrow: 'Step 3',
    title: 'Complete the next request',
    text: 'Upload the documents needed for your active onboarding step.',
    detailedText: 'Vertex Bridge breaks down document collection into clear, bite-sized tasks. Upload required files (such as EIN confirmations, banking credentials, or academic schedules) through our secure portal.',
    tip: 'Our system accepts PDF, JPG, and PNG files up to 10MB. Document verification takes less than 24 hours.',
    icon: UploadCloud,
  },
  {
    eyebrow: 'Step 4',
    title: 'Ask when something is unclear',
    text: 'Get plain-language guidance without leaving the portal.',
    detailedText: 'Never guess what a request means. Use VertexAI, our integrated assistant, to get instant explanations of complex document requirements, or leave a message for your dedicated partner coordinator.',
    tip: 'Look for the chat icon in the bottom corner of your workspace to open VertexAI at any time.',
    icon: MessageCircle,
  },
]

function IndexPage() {
  const navigate = useNavigate()
  const { data: session } = authClient.useSession()
  const role = session?.user ? (session.user as any).role : null
  const [email, setEmail] = useState('')
  const [activeStep, setActiveStep] = useState(0)

  const continueToLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigate({
      to: '/login',
      search: {
        email: email.trim() || undefined,
        invite_token: undefined,
        redirect: undefined,
      },
    })
  }

  // Determine standard portal access button parameters
  let portalLink = '/login'
  let portalText = 'Access Portal'
  if (role) {
    portalText = 'Go to Dashboard'
    if (role === 'school_user') {
      portalLink = '/school-onboarding'
    } else if (role === 'vertex_user' || role === 'admin') {
      portalLink = '/vertex-dashboard'
    }
  }

  return (
    <div className="min-h-screen bg-transparent flex flex-col">
      {/* Homepage Dedicated Header Top-Bar */}
      <header className="w-full border-b border-[var(--line)] bg-white/40 backdrop-blur-md sticky top-0 z-50">
        <div className="page-wrap flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <img
              src="/brand/vertex-horizontal.svg"
              alt="Vertex Education"
              className="h-8 sm:h-11 w-auto"
            />
            <div className="hidden sm:flex flex-col border-l border-[var(--chip-line)] pl-3">
              <span className="font-display text-sm font-black uppercase leading-tight tracking-[0.08em] text-[var(--vertex-blue)]">
                Vertex Bridge
              </span>
              <span className="text-[9.5px] font-bold uppercase leading-none tracking-[0.18em] text-[var(--vertex-gray)]">
                School Onboarding Portal
              </span>
            </div>
          </div>
          <div>
            <Link
              to={portalLink as any}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--vertex-blue)] px-5 text-sm font-bold text-[var(--vertex-blue)] hover:bg-[var(--vertex-blue)] hover:text-white transition-all shadow-sm"
            >
              {portalText}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-grow">
        <div className="page-wrap py-10 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:items-stretch">
            {/* Left Column: Welcome, Text, and Workspace Access Form */}
            <div className="lg:col-span-8 flex flex-col justify-between gap-6 lg:gap-0 text-left lg:py-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--vertex-gold)]/35 bg-[var(--vertex-gold)]/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--vertex-blue)] self-start">
                <Sparkles size={14} className="text-[var(--vertex-gold)]" />
                Partner School Portal
              </div>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.25rem] font-black leading-[1.08] text-[var(--vertex-blue)]">
                Your onboarding journey, guided.
              </h1>
              <p className="text-base sm:text-lg text-[var(--sea-ink-soft)] leading-relaxed font-medium">
                Vertex Bridge is the secure, guided portal designed specifically for our partner schools. Enter your email to open your dedicated workspace, complete requests, and launch your integration smoothly.
              </p>

              {/* Email Form Access Card */}
              <div className="mt-2 w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--line)] bg-white/70 shadow-[0_24px_50px_rgba(0,56,101,0.12)] backdrop-blur-md">
                <div className="flex items-center gap-3 bg-[var(--vertex-blue)] px-5 py-4 text-white">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--vertex-gold)] text-[var(--vertex-blue)] shadow-md">
                    <Mail size={18} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="m-0 text-xs font-black uppercase tracking-[0.16em] text-white/75">
                      Launch Workspace
                    </p>
                    <p className="m-0 text-sm font-semibold">Enter your school email to begin.</p>
                  </div>
                </div>
                <form onSubmit={continueToLogin} className="flex flex-col gap-3 p-4 sm:flex-row">
                  <div className="flex min-h-12 flex-1 items-center gap-3 rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] px-4 focus-within:border-[var(--vertex-blue)] focus-within:ring-2 focus-within:ring-[var(--vertex-blue)]/10 transition-all">
                    <Mail size={18} className="text-[var(--vertex-gray)]" aria-hidden="true" />
                    <input
                      id="school-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="e.g. administrator@yourschool.edu"
                      className="h-12 min-w-0 flex-1 bg-transparent text-sm font-semibold text-[var(--sea-ink)] outline-none placeholder:text-[var(--vertex-gray)]"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--vertex-blue)] bg-[var(--vertex-blue)] px-6 text-sm font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-[var(--lagoon-deep)] active:translate-y-0"
                  >
                    Launch
                    <ArrowRight size={16} strokeWidth={2.5} />
                  </button>
                </form>
              </div>

              {/* Highlights/Badges */}
              <div className="flex flex-wrap gap-4 mt-2 text-xs font-extrabold text-[var(--sea-ink)]">
                {['AI Guidance', 'Secure Direct Uploads', 'Dedicated Coordinators'].map((item) => (
                  <span key={item} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/50 border border-[var(--line)] shadow-sm">
                    <CheckCircle2 size={14} className="text-[var(--vertex-gold)]" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* Right Column: Hero Artwork */}
            <div className="lg:col-span-4 flex justify-center lg:justify-end items-center w-full relative">
              {/* Decorative Glow */}
              <div className="absolute -inset-4 bg-gradient-to-tr from-[var(--vertex-blue)]/10 to-[var(--vertex-gold)]/5 rounded-[2.5rem] blur-xl opacity-75 -z-10 pointer-events-none" />

              <figure className="m-0 w-full max-w-[380px] rounded-[1.25rem] border border-white/30 bg-[var(--vertex-blue)] p-1 shadow-[0_24px_60px_rgba(0,56,101,0.2)] relative group overflow-hidden">
                <div className="flex w-full items-center justify-center overflow-hidden rounded-[0.95rem] bg-[var(--lagoon-deep)] p-1 relative">
                  <img
                    src="/brand/vertex-onboarding-ascent.webp"
                    alt="A climber above a mountain landscape blended with a classroom learning moment"
                    className="w-full h-[440px] sm:h-[540px] lg:h-[640px] rounded-[0.6rem] object-cover shadow-[0_15px_35px_rgba(0,0,0,0.35)] transition-transform duration-700 group-hover:scale-[1.02]"
                  />
                </div>
              </figure>
            </div>
          </div>
        </div>

        {/* Journey Timeline Section */}
        <section className="bg-white/40 border-t border-b border-[var(--line)] py-14 lg:py-20 backdrop-blur-sm">
          <div className="page-wrap text-center flex flex-col gap-10">
            <div className="max-w-2xl mx-auto flex flex-col gap-3">
              <p className="island-kicker">Interactive Roadmap</p>
              <h2 className="font-display text-3xl sm:text-4xl font-black text-[var(--vertex-blue)]">
                The Road to a Successful Launch
              </h2>
              <p className="text-base text-[var(--sea-ink-soft)] font-medium">
                We make school onboarding organized and transparent. Discover the exact steps in your launch journey, designed to get your integration running with clear milestones.
              </p>
            </div>

            {/* Custom Stepper Container */}
            <div className="w-full max-w-5xl mx-auto">
              {/* Mobile: Accordion Stepper (under lg screens) */}
              <div className="lg:hidden flex flex-col gap-3 text-left">
                {journeySteps.map((step, index) => {
                  const StepIcon = step.icon
                  const isActive = index === activeStep

                  return (
                    <div
                      key={step.title}
                      className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
                        isActive
                          ? 'border-[var(--vertex-blue)] bg-white shadow-md'
                          : 'border-[var(--line)] bg-white/60 hover:bg-white/95'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveStep(index)}
                        className="w-full flex items-center justify-between gap-4 p-4 text-left font-bold"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                              isActive
                                ? 'bg-[var(--vertex-blue)] text-white shadow-md'
                                : 'bg-[var(--foam)] text-[var(--vertex-gray)] border border-[var(--chip-line)]'
                            }`}
                          >
                            <StepIcon size={20} strokeWidth={2.4} aria-hidden="true" />
                          </span>
                          <div>
                            <span className="block text-[10px] font-black uppercase tracking-widest text-[var(--vertex-gold)] leading-none">
                              {step.eyebrow}
                            </span>
                            <span className="block text-sm sm:text-base font-black text-[var(--vertex-blue)] mt-1">
                              {step.title}
                            </span>
                          </div>
                        </div>
                        <div
                          className={`h-6 w-6 rounded-full border border-[var(--chip-line)] flex items-center justify-center text-[var(--vertex-blue)] transition-transform duration-300 ${
                            isActive ? 'rotate-90 bg-[var(--foam)]' : ''
                          }`}
                        >
                          <ArrowRight size={14} strokeWidth={2.5} />
                        </div>
                      </button>

                      {/* Expandable Accordion Body */}
                      <div
                        className={`transition-all duration-300 ease-in-out ${
                          isActive ? 'max-h-[26rem] border-t border-[var(--line)] p-5' : 'max-h-0 pointer-events-none'
                        }`}
                        style={{ contentVisibility: isActive ? 'auto' : 'hidden' }}
                      >
                        <div className="flex flex-col gap-4">
                          <p className="text-sm leading-relaxed text-[var(--sea-ink)] font-medium">
                            {step.detailedText}
                          </p>

                          {/* Pro Tip Box */}
                          <div className="flex items-start gap-3 rounded-xl border border-[var(--vertex-gold)]/20 bg-[var(--vertex-gold)]/5 p-3.5">
                            <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--vertex-gold)] text-[var(--vertex-blue)] shadow-sm">
                              <Sparkles size={12} strokeWidth={2.5} aria-hidden="true" />
                            </div>
                            <div>
                              <p className="m-0 text-[10px] font-black uppercase tracking-wider text-[var(--vertex-gold)]">
                                Pro Tip
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-[var(--sea-ink-soft)] font-semibold">
                                {step.tip}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop Layout (lg screens and up) */}
              <div className="hidden lg:grid lg:grid-cols-12 gap-8 items-stretch text-left">
                {/* Left Column: Vertical Stepper Buttons with connector line */}
                <div className="col-span-5 flex flex-col justify-between py-2 relative">
                  {/* Timeline Line Graphic */}
                  <div className="absolute left-7 top-6 bottom-6 w-0.5 bg-[var(--line)] -z-10" />

                  {journeySteps.map((step, index) => {
                    const StepIcon = step.icon
                    const isActive = index === activeStep

                    return (
                      <button
                        key={step.title}
                        type="button"
                        onClick={() => setActiveStep(index)}
                        className={`group flex items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-300 w-full ${
                          isActive
                            ? 'border-[var(--vertex-blue)] bg-white shadow-md translate-x-2'
                            : 'border-transparent bg-transparent hover:bg-white/40'
                        }`}
                      >
                        {/* Stepper Circle */}
                        <div
                          className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-all duration-300 z-10 shrink-0 ${
                            isActive
                              ? 'bg-[var(--vertex-blue)] text-white shadow-lg scale-105'
                              : 'bg-white text-[var(--vertex-gray)] border border-[var(--chip-line)] group-hover:border-[var(--vertex-blue)] group-hover:text-[var(--vertex-blue)]'
                          }`}
                        >
                          <StepIcon size={24} strokeWidth={2.2} />
                        </div>

                        <div>
                          <span className={`block text-xs font-black uppercase tracking-widest leading-none transition-colors ${isActive ? 'text-[var(--vertex-gold)]' : 'text-[var(--vertex-gray)]'}`}>
                            {step.eyebrow}
                          </span>
                          <span className="block text-base font-black text-[var(--vertex-blue)] mt-1.5">
                            {step.title}
                          </span>
                          <span className="block text-xs text-[var(--sea-ink-soft)] mt-1 font-semibold line-clamp-1">
                            {step.text}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Right Column: Display Card (shows active step details) */}
                <div className="col-span-7 flex">
                  <div className="w-full rounded-[2rem] border border-[var(--line)] bg-white/70 p-8 shadow-[0_24px_50px_rgba(0,56,101,0.1)] backdrop-blur-md flex flex-col justify-between gap-6 rise-in">
                    {/* Step Detail Header */}
                    <div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="inline-block rounded-full border border-[var(--vertex-gold)]/35 bg-[var(--vertex-gold)]/10 px-3 py-1 text-xs font-black uppercase tracking-wider text-[var(--vertex-blue)]">
                          {journeySteps[activeStep].eyebrow}
                        </span>
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--vertex-gold)] text-[var(--vertex-blue)] shadow-md">
                          {(() => {
                            const ActiveIcon = journeySteps[activeStep].icon
                            return <ActiveIcon size={22} strokeWidth={2.4} />
                          })()}
                        </span>
                      </div>

                      <h3 className="font-display text-2xl font-black text-[var(--vertex-blue)] mt-5">
                        {journeySteps[activeStep].title}
                      </h3>

                      <p className="text-base text-[var(--sea-ink-soft)] leading-relaxed mt-4 font-semibold">
                        {journeySteps[activeStep].detailedText}
                      </p>
                    </div>

                    {/* Pro Tip Callout Card */}
                    <div className="flex items-start gap-4 rounded-2xl border border-[var(--vertex-gold)]/20 bg-[linear-gradient(165deg,var(--foam),rgba(203,160,82,0.03))] p-5 shadow-sm">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--vertex-gold)] text-[var(--vertex-blue)] shadow-sm">
                        <Sparkles size={16} strokeWidth={2.5} aria-hidden="true" />
                      </div>
                      <div>
                        <p className="m-0 text-xs font-black uppercase tracking-wider text-[var(--vertex-gold)]">
                          Pro Tip for Administrators
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-[var(--sea-ink)] font-medium">
                          {journeySteps[activeStep].tip}
                        </p>
                      </div>
                    </div>

                    {/* Stepper Navigation Buttons */}
                    <div className="flex justify-between items-center border-t border-[var(--line)] pt-5 mt-2">
                      <span className="text-xs font-extrabold uppercase tracking-widest text-[var(--vertex-gray)]">
                        Step {activeStep + 1} of {journeySteps.length}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveStep((curr) => (curr - 1 + journeySteps.length) % journeySteps.length)}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--chip-line)] bg-white text-[var(--vertex-blue)] shadow-sm hover:bg-neutral-50 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                        >
                          <ArrowLeft size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveStep((curr) => (curr + 1) % journeySteps.length)}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--vertex-blue)] bg-[var(--vertex-blue)] text-white shadow-sm hover:bg-[var(--lagoon-deep)] hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust & Support Section */}
        <section className="py-12 lg:py-16">
          <div className="page-wrap max-w-4xl text-center flex flex-col items-center gap-6">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--vertex-gold)]/10 border border-[var(--vertex-gold)]/30 text-[var(--vertex-blue)] shadow-sm">
              <MessageCircle size={22} strokeWidth={2.4} />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-display text-xl sm:text-2xl font-black text-[var(--vertex-blue)]">
                Dedicated Support Every Step of the Way
              </h3>
              <p className="text-sm sm:text-base text-[var(--sea-ink-soft)] max-w-2xl leading-relaxed font-semibold">
                Have questions about document specifications or integration timelines? Our portal features{' '}
                <strong className="font-black text-[var(--vertex-blue)]">VertexAI</strong>, an intelligent assistant to explain compliance requests in plain English. For custom needs, your dedicated onboarding coordinator is just a click away.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
