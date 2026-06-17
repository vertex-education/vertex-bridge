import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { authClient } from '#/lib/auth-client'
import {
  acceptInvite,
  acceptInviteForCurrentUser,
  getInviteByToken,
  resetInviteAccountPassword,
} from '#/lib/invitations'
import { BrandedAlert } from '#/components/BrandedAlert'

function sanitizeRedirect(url: unknown) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) {
    return undefined
  }

  return url
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    invite_token: typeof search.invite_token === 'string' ? search.invite_token : undefined,
    redirect: sanitizeRedirect(search.redirect),
    email: typeof search.email === 'string' ? search.email : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const { invite_token, redirect, email: emailSearch } = Route.useSearch()
  const navigate = useNavigate()
  
  // Login form state
  const [email, setEmail] = useState(emailSearch ?? '')
  const [password, setPassword] = useState('')
  
  // Invitation signup form state
  const [name, setName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  
  // Invitation details state
  const [inviteDetails, setInviteDetails] = useState<any | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')

  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [autoLoginFailed, setAutoLoginFailed] = useState(false)
  const [showInvitePasswordReset, setShowInvitePasswordReset] = useState(false)

  const showManualLogin = (nextEmail = email) => {
    setInviteDetails(null)
    setInviteError('')
    setErrorMsg('')
    setAutoLoginFailed(false)
    setShowInvitePasswordReset(false)
    setPassword('')
    navigate({
      to: '/login',
      search: nextEmail ? { email: nextEmail } : {},
    })
  }

  // Load invitation if token is present
  useEffect(() => {
    if (invite_token) {
      setInviteLoading(true)
      getInviteByToken({ data: invite_token })
        .then((details) => {
          setInviteDetails(details)
          setName('')
          setEmail(details.email)
          setPassword('')
          setNewPassword('')
          setConfirmPassword('')
          setShowInvitePasswordReset(false)
        })
        .catch((err) => {
          setInviteError(err.message || 'Invalid or expired invitation token.')
        })
        .finally(() => {
          setInviteLoading(false)
        })
    }
  }, [invite_token])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setAutoLoginFailed(false)
    try {
      const resp = await authClient.signIn.email({
        email,
        password,
      })
      if (resp.error) {
        setErrorMsg(resp.error.message || 'Invalid email or password')
      } else {
        if (invite_token && inviteDetails?.accountExists) {
          try {
            await acceptInviteForCurrentUser({ data: invite_token })
          } catch (err) {
            console.error('Signed in, but invite acceptance could not be finalized immediately:', err)
          }
        }

        // Fetch session to determine role and redirect
        const session = await authClient.getSession()
        const role = session.data?.user ? (session.data.user as any).role : null
        
        if (role === 'school_leader' || role === 'school_staff' || role === 'school_user') {
          navigate({ to: '/school-onboarding' })
        } else if (redirect) {
          navigate({ to: redirect as any })
        } else if (role === 'vertex_user' || role === 'admin') {
          navigate({ to: '/vertex-dashboard' })
        } else {
          navigate({ to: '/' })
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleInvitePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.')
      return
    }

    setLoading(true)
    setErrorMsg('')
    setAutoLoginFailed(false)

    try {
      const resetInvite = await resetInviteAccountPassword({
        data: {
          token: invite_token!,
          password: newPassword,
        },
      })

      const signInResp = await authClient.signIn.email({
        email: resetInvite.email,
        password: newPassword,
      })

      if (signInResp.error) {
        setErrorMsg(signInResp.error.message || 'Password reset, but automatic login failed. Please sign in manually.')
        setAutoLoginFailed(true)
      } else {
        navigate({ to: '/school-onboarding' })
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reset password.')
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.')
      return
    }
    setLoading(true)
    setErrorMsg('')
    setAutoLoginFailed(false)

    try {
      // 1. Create the account and complete invite
      const acceptedInvite = await acceptInvite({
        data: {
          token: invite_token!,
          name,
          password: newPassword,
        }
      })

      // 2. Automatically log in the user
      const signInResp = await authClient.signIn.email({
        email: acceptedInvite.email,
        password: newPassword,
      })

      if (signInResp.error) {
        setErrorMsg(signInResp.error.message || 'Account created, but automatic login failed. Please sign in manually.')
        setAutoLoginFailed(true)
      } else {
        navigate({ to: '/school-onboarding' })
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to complete password setup.')
    } finally {
      setLoading(false)
    }
  }

  if (invite_token && inviteLoading) {
    return (
      <main className="page-wrap page-center-state">
        <div>
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[var(--vertex-blue)] border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
          <p className="mt-4 text-sm text-[var(--sea-ink-soft)]">Validating invitation credentials...</p>
        </div>
      </main>
    )
  }

  if (invite_token && inviteError) {
    return (
      <main className="page-wrap page-center-state">
        <div className="island-shell page-center-card rounded-2xl p-8">
          <BrandedAlert variant="error" title="Invitation error" className="mb-6 text-left">
            {inviteError}
          </BrandedAlert>
          <button
            type="button"
            onClick={() => showManualLogin('')}
            className="inline-block cursor-pointer rounded-xl bg-[var(--vertex-blue)] px-6 py-2.5 font-bold text-white transition hover:bg-[var(--lagoon-deep)]"
          >
            Go to Login
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="page-wrap page-shell">
      <div className="page-stack page-stack-auth">
        <div className="island-shell rounded-2xl p-5 sm:p-8">
          
          {inviteDetails?.accountExists ? (
            // Existing account invite flow
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                Invitation Found
              </div>
              <h2 className="display-title mb-2 text-2xl font-bold text-[var(--vertex-blue)]">
                Sign in to add this school
              </h2>
              <p className="mb-6 text-sm text-[var(--sea-ink-soft)]">
                This invite is for <strong>{inviteDetails.schoolName || 'a Vertex Bridge school'}</strong>. Sign in with <strong>{inviteDetails.email}</strong> to add it to your onboarding workspace.
              </p>

              {errorMsg && (
                <BrandedAlert variant="error" title={showInvitePasswordReset ? 'Password reset failed' : 'Sign-in failed'} className="mb-4">
                  <span>
                    {errorMsg}
                    {autoLoginFailed && (
                      <button
                        type="button"
                        onClick={() => showManualLogin(email)}
                        className="mt-3 block rounded-lg bg-[var(--vertex-blue)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)]"
                      >
                        Sign in manually
                      </button>
                    )}
                  </span>
                </BrandedAlert>
              )}

              {showInvitePasswordReset ? (
                <form onSubmit={handleInvitePasswordReset} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={email}
                      disabled
                      className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2 text-neutral-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={6}
                      className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full cursor-pointer rounded-xl bg-[var(--vertex-blue)] py-3 font-bold text-white shadow-md transition hover:bg-[var(--lagoon-deep)] disabled:opacity-50"
                  >
                    {loading ? 'Resetting Password...' : 'Reset Password & Continue'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowInvitePasswordReset(false)
                      setErrorMsg('')
                      setNewPassword('')
                      setConfirmPassword('')
                    }}
                    className="w-full rounded-xl border border-[var(--chip-line)] py-3 text-sm font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)]"
                  >
                    Back to sign in
                  </button>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={email}
                      disabled
                      className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2 text-neutral-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full cursor-pointer rounded-xl bg-[var(--vertex-blue)] py-3 font-bold text-white shadow-md transition hover:bg-[var(--lagoon-deep)] disabled:opacity-50"
                  >
                    {loading ? 'Signing In...' : 'Sign In & Add School'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowInvitePasswordReset(true)
                      setErrorMsg('')
                      setPassword('')
                    }}
                    className="w-full rounded-xl border border-[var(--chip-line)] py-3 text-sm font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)]"
                  >
                    Reset password
                  </button>
                </form>
              )}
            </div>
          ) : inviteDetails ? (
            // Invitation Setup Password Flow
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                Invitation Code Verified
              </div>
              <h2 className="display-title text-2xl font-bold text-[var(--vertex-blue)] mb-2">
                {inviteDetails.schoolContactRole === 'school_staff' ? 'Set up school staff access' : 'Set Your Password'}
              </h2>
              <p className="text-sm text-[var(--sea-ink-soft)] mb-6">
                Welcome to Vertex Bridge. This invite will add <strong>{inviteDetails.email}</strong> as <strong>{inviteDetails.role === 'school_staff' || inviteDetails.schoolContactRole === 'school_staff' ? 'School Staff' : inviteDetails.role === 'school_leader' || inviteDetails.role === 'school_user' ? 'School Leader' : 'Vertex Staff'}</strong> for <strong>{inviteDetails.schoolName || 'Vertex Education'}</strong>.
              </p>

              {errorMsg && (
                <BrandedAlert variant="error" title="Unable to complete setup" className="mb-4">
                  <span>
                    {errorMsg}
                    {autoLoginFailed && (
                      <button
                        type="button"
                        onClick={() => showManualLogin(email)}
                        className="mt-3 block rounded-lg bg-[var(--vertex-blue)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)]"
                      >
                        Sign in manually
                      </button>
                    )}
                  </span>
                </BrandedAlert>
              )}

              <form onSubmit={handleAcceptInvite} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full px-4 py-2 border border-[var(--chip-line)] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    className="w-full px-4 py-2 border border-neutral-200 rounded-xl bg-neutral-50 text-neutral-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                    Create Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Min 6 characters"
                    className="w-full px-4 py-2 border border-[var(--chip-line)] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    placeholder="Repeat password"
                    className="w-full px-4 py-2 border border-[var(--chip-line)] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-[var(--vertex-blue)] hover:bg-[var(--lagoon-deep)] text-white font-bold rounded-xl shadow-md cursor-pointer transition disabled:opacity-50"
                >
                  {loading ? 'Creating Account...' : 'Set Password & Get Started'}
                </button>
              </form>
            </div>
          ) : (
            // Standard Login Flow
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                Secure Portal Access
              </div>
              <h2 className="display-title text-2xl font-bold text-[var(--vertex-blue)] mb-6">
                Sign in to Vertex Bridge
              </h2>

              {errorMsg && (
                <BrandedAlert variant="error" title="Sign-in failed" className="mb-4">
                  {errorMsg}
                </BrandedAlert>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-2 border border-[var(--chip-line)] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-2 border border-[var(--chip-line)] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-[var(--vertex-blue)] hover:bg-[var(--lagoon-deep)] text-white font-bold rounded-xl shadow-md cursor-pointer transition disabled:opacity-50"
                >
                  {loading ? 'Signing In...' : 'Sign In'}
                </button>
              </form>
            </div>
          )}

        </div>
      </div>
    </main>
  )
}
