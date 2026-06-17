import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { CLIENT_TYPES } from '#/lib/client-types'
import { getServerRequest } from '#/lib/security'

type MockSeedSchool = {
  schoolName: string
  state: string
  services: string
  clientType: string
  primaryContactName: string
  primaryContactEmail: string
  onboardingCoordinator: string
  onboardingStartDate: string
}

type AsanaTemplateOption = {
  gid: string
  name: string
  workspaceGid: string
  workspaceName: string
  teamGid: string
  teamName: string
}

type AsanaTeamOption = {
  gid: string
  name: string
}

const mockSeedSchools: MockSeedSchool[] = [
  {
    schoolName: 'Mock Academy',
    state: 'California',
    services: 'SFO (Accounting, AP, Payroll)',
    clientType: 'New',
    primaryContactName: 'Jordan Lee',
    primaryContactEmail: 'jordan.lee@mockacademy.example',
    onboardingCoordinator: 'Vertex onboarding team',
    onboardingStartDate: '2026-08-15',
  },
  {
    schoolName: 'Blue Harbor Charter School',
    state: 'California',
    services: 'SFO (Accounting, AP, Payroll, Grants)',
    clientType: 'New',
    primaryContactName: 'Maya Chen',
    primaryContactEmail: 'maya.chen@blueharborcharter.example',
    onboardingCoordinator: 'Tara L. (Grants Lead)',
    onboardingStartDate: '2026-08-18',
  },
  {
    schoolName: 'Pioneer Mesa Prep',
    state: 'Arizona',
    services: 'SFO (Accounting, AP)',
    clientType: 'Existing',
    primaryContactName: 'Daniel Ruiz',
    primaryContactEmail: 'daniel.ruiz@pioneermesa.example',
    onboardingCoordinator: 'Marisol R. (Accounting Lead)',
    onboardingStartDate: '2026-08-20',
  },
  {
    schoolName: 'Cedar Grove Learning Collaborative',
    state: 'Oregon',
    services: 'SFO (Accounting, Payroll)',
    clientType: 'New',
    primaryContactName: 'Avery Thompson',
    primaryContactEmail: 'avery.thompson@cedargrovelearning.example',
    onboardingCoordinator: 'Eugene B. (AP/Payroll Lead)',
    onboardingStartDate: '2026-08-24',
  },
  {
    schoolName: 'Northstar STEM Charter',
    state: 'Washington',
    services: 'SFO (Accounting, AP, Payroll)',
    clientType: 'New',
    primaryContactName: 'Priya Nair',
    primaryContactEmail: 'priya.nair@northstarstem.example',
    onboardingCoordinator: 'Eugene B. (AP/Payroll Lead)',
    onboardingStartDate: '2026-08-26',
  },
  {
    schoolName: 'Silver Lake Classical Academy',
    state: 'Nevada',
    services: 'SFO (Accounting, AP, Grants)',
    clientType: 'Existing New',
    primaryContactName: 'Marcus Bell',
    primaryContactEmail: 'marcus.bell@silverlakeclassical.example',
    onboardingCoordinator: 'Tara L. (Grants Lead)',
    onboardingStartDate: '2026-08-31',
  },
  {
    schoolName: 'Redwood Valley Charter',
    state: 'California',
    services: 'SFO (Accounting, AP, Payroll, Grants)',
    clientType: 'New',
    primaryContactName: 'Elena Park',
    primaryContactEmail: 'elena.park@redwoodvalleycharter.example',
    onboardingCoordinator: 'Marisol R. (Accounting Lead)',
    onboardingStartDate: '2026-09-02',
  },
  {
    schoolName: 'Summit Creek Preparatory',
    state: 'Colorado',
    services: 'SFO (AP, Payroll)',
    clientType: 'New',
    primaryContactName: 'Noah Kim',
    primaryContactEmail: 'noah.kim@summitcreekprep.example',
    onboardingCoordinator: 'Eugene B. (AP/Payroll Lead)',
    onboardingStartDate: '2026-09-08',
  },
  {
    schoolName: 'Riverstone Community School',
    state: 'Texas',
    services: 'SFO (Accounting, AP)',
    clientType: 'Existing',
    primaryContactName: 'Camila Ortiz',
    primaryContactEmail: 'camila.ortiz@riverstonecommunity.example',
    onboardingCoordinator: 'Marisol R. (Accounting Lead)',
    onboardingStartDate: '2026-09-10',
  },
  {
    schoolName: 'Lighthouse Arts Charter',
    state: 'New York',
    services: 'SFO (Accounting, AP, Payroll)',
    clientType: 'New',
    primaryContactName: 'Harper Ellis',
    primaryContactEmail: 'harper.ellis@lighthousearts.example',
    onboardingCoordinator: 'Tara L. (Grants Lead)',
    onboardingStartDate: '2026-09-14',
  },
  {
    schoolName: 'Prairie View STEM Academy',
    state: 'Kansas',
    services: 'SFO (Accounting, Payroll)',
    clientType: 'New',
    primaryContactName: 'Owen Brooks',
    primaryContactEmail: 'owen.brooks@prairieviewstem.example',
    onboardingCoordinator: 'Eugene B. (AP/Payroll Lead)',
    onboardingStartDate: '2026-09-16',
  },
  {
    schoolName: 'Granite Peak Charter School',
    state: 'Utah',
    services: 'SFO (Accounting, AP, Grants)',
    clientType: 'Existing',
    primaryContactName: 'Sofia Martinez',
    primaryContactEmail: 'sofia.martinez@granitepeakcharter.example',
    onboardingCoordinator: 'Tara L. (Grants Lead)',
    onboardingStartDate: '2026-09-21',
  },
  {
    schoolName: 'Magnolia Bridge Academy',
    state: 'Louisiana',
    services: 'SFO (Accounting, AP, Payroll)',
    clientType: 'New',
    primaryContactName: 'Isaac Carter',
    primaryContactEmail: 'isaac.carter@magnoliabridge.example',
    onboardingCoordinator: 'Marisol R. (Accounting Lead)',
    onboardingStartDate: '2026-09-23',
  },
  {
    schoolName: 'Evergreen Scholars Network',
    state: 'Minnesota',
    services: 'SFO (Accounting, AP)',
    clientType: 'Existing',
    primaryContactName: 'Nora Patel',
    primaryContactEmail: 'nora.patel@evergreenscholars.example',
    onboardingCoordinator: 'Marisol R. (Accounting Lead)',
    onboardingStartDate: '2026-09-28',
  },
  {
    schoolName: 'Liberty Oaks Preparatory',
    state: 'Pennsylvania',
    services: 'SFO (Accounting, AP, Payroll, Grants)',
    clientType: 'New',
    primaryContactName: 'Miles Johnson',
    primaryContactEmail: 'miles.johnson@libertyoaksprep.example',
    onboardingCoordinator: 'Tara L. (Grants Lead)',
    onboardingStartDate: '2026-10-01',
  },
  {
    schoolName: 'Desert Sky Learning Center',
    state: 'New Mexico',
    services: 'SFO (Accounting, Payroll)',
    clientType: 'New',
    primaryContactName: 'Leah Morgan',
    primaryContactEmail: 'leah.morgan@desertskylearning.example',
    onboardingCoordinator: 'Eugene B. (AP/Payroll Lead)',
    onboardingStartDate: '2026-10-05',
  },
  {
    schoolName: 'Harborview Public Charter',
    state: 'Massachusetts',
    services: 'SFO (Accounting, AP, Grants)',
    clientType: 'Existing',
    primaryContactName: 'Ethan Walker',
    primaryContactEmail: 'ethan.walker@harborviewcharter.example',
    onboardingCoordinator: 'Tara L. (Grants Lead)',
    onboardingStartDate: '2026-10-07',
  },
  {
    schoolName: 'Mountain Trail Academy',
    state: 'Idaho',
    services: 'SFO (Accounting, AP, Payroll)',
    clientType: 'New',
    primaryContactName: 'Grace Liu',
    primaryContactEmail: 'grace.liu@mountaintrailacademy.example',
    onboardingCoordinator: 'Eugene B. (AP/Payroll Lead)',
    onboardingStartDate: '2026-10-12',
  },
  {
    schoolName: 'Oak Meadow Innovation School',
    state: 'Tennessee',
    services: 'SFO (Accounting, AP)',
    clientType: 'New',
    primaryContactName: 'Caleb Stone',
    primaryContactEmail: 'caleb.stone@oakmeadowinnovation.example',
    onboardingCoordinator: 'Marisol R. (Accounting Lead)',
    onboardingStartDate: '2026-10-14',
  },
  {
    schoolName: 'Beacon Ridge Charter Academy',
    state: 'Florida',
    services: 'SFO (Accounting, AP, Payroll, Grants)',
    clientType: 'Existing',
    primaryContactName: 'Amara Wilson',
    primaryContactEmail: 'amara.wilson@beaconridgecharter.example',
    onboardingCoordinator: 'Vertex onboarding team',
    onboardingStartDate: '2026-10-19',
  },
]

const getAdminIntegrationsAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const { auth } = await import('#/lib/auth')
  const request = await getServerRequest()
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  return {
    isSignedIn: Boolean(session?.user),
    isAdmin: (session?.user as any)?.role === 'admin',
  }
})

const getIntegrationsStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireStaffSession } = await import('#/lib/security')
  const { getAsanaConnectionStatus } = await import('#/lib/asana-oauth.server')
  const request = await getServerRequest()

  await requireStaffSession()

  return {
    asana: await getAsanaConnectionStatus(request),
    hubspot: {
      isConnected: true,
      mode: 'Mock',
      connectedByName: 'Vertex Demo',
      connectedAt: new Date('2026-07-01T09:00:00.000Z').toISOString(),
      description: 'Demo-safe company and deal sync is simulated for the current onboarding workflow.',
    },
  }
})

const saveAsanaCredentials = createServerFn({ method: 'POST' })
  .validator((data: {
    clientId: string
    clientSecret: string
    redirectUri?: string
  }) => data)
  .handler(async ({ data }) => {
    const { saveAsanaOAuthSettings } = await import('#/lib/asana-oauth.server')
    return await saveAsanaOAuthSettings({ data })
  })

const clearAsanaCredentials = createServerFn({ method: 'POST' })
  .handler(async () => {
    const { clearAsanaOAuthSettings } = await import('#/lib/asana-oauth.server')
    return await clearAsanaOAuthSettings()
  })

const loadAsanaTemplates = createServerFn({ method: 'POST' })
  .validator((data: {
    workspaceGid?: string
    teamGid?: string
    teamName?: string
  }) => data)
  .handler(async ({ data }) => {
    const { listAsanaProjectTemplates } = await import('#/lib/asana-oauth.server')
    return await listAsanaProjectTemplates({ data })
  })

const loadAsanaTeams = createServerFn({ method: 'POST' })
  .validator((data: {
    workspaceGid?: string
  }) => data)
  .handler(async ({ data }) => {
    const { listAsanaTeams } = await import('#/lib/asana-oauth.server')
    return await listAsanaTeams({ data })
  })

const saveAsanaTemplateSelection = createServerFn({ method: 'POST' })
  .validator((data: {
    projectTemplateGid: string
    projectTemplateName: string
    workspaceGid?: string
    teamGid?: string
  }) => data)
  .handler(async ({ data }) => {
    const { saveAsanaProjectTemplateSettings } = await import('#/lib/asana-oauth.server')
    return await saveAsanaProjectTemplateSettings({ data })
  })

const seedMockHubSpotSchool = createServerFn({ method: 'POST' })
  .validator((data: {
    schoolName: string
    state: string
    services: string
    clientType: string
    primaryContactName: string
    primaryContactEmail: string
    onboardingCoordinator: string
    onboardingStartDate: string
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { clientProfiles } = await import('#/db/schema')
    const { assertTrustedOrigin, requireAdminSession } = await import('#/lib/security')
    const { provisionAsanaProjectForSchool } = await import('#/lib/asana')
    const { recordAuditEvent } = await import('#/lib/audit')

    await assertTrustedOrigin()
    const session = await requireAdminSession()
    const request = await getServerRequest()
    const schoolName = data.schoolName.trim()
    const now = new Date()

    if (!schoolName) throw new Error('School name is required.')
    if (!data.primaryContactEmail.trim()) throw new Error('Primary contact email is required.')
    if (!data.onboardingStartDate.trim()) throw new Error('Onboarding start date is required.')

    const profile = {
      id: `hubspot-mock-${crypto.randomUUID()}`,
      schoolName,
      state: data.state.trim() || 'California',
      services: data.services.trim() || 'SFO',
      clientType: data.clientType.trim() || 'New',
      primaryContactName: data.primaryContactName.trim() || 'Mock Contact',
      primaryContactEmail: data.primaryContactEmail.trim(),
      onboardingCoordinator: data.onboardingCoordinator.trim() || 'Vertex onboarding team',
      onboardingStartDate: data.onboardingStartDate.trim(),
      hubspotCompanyId: `hs-mock-company-${crypto.randomUUID()}`,
      hubspotDealId: `hs-mock-deal-${crypto.randomUUID()}`,
      lifecycleStage: 'Contract Signed',
      createdAt: now,
      updatedAt: now,
    }

    await db
      .insert(clientProfiles)
      .values(profile)
      .onConflictDoUpdate({
        target: clientProfiles.schoolName,
        set: {
          state: profile.state,
          services: profile.services,
          clientType: profile.clientType,
          primaryContactName: profile.primaryContactName,
          primaryContactEmail: profile.primaryContactEmail,
          onboardingCoordinator: profile.onboardingCoordinator,
          onboardingStartDate: profile.onboardingStartDate,
          hubspotCompanyId: profile.hubspotCompanyId,
          hubspotDealId: profile.hubspotDealId,
          lifecycleStage: profile.lifecycleStage,
          updatedAt: now,
        },
      })
      .run()

    await recordAuditEvent({
      session,
      request,
      surface: 'admin',
      category: 'hubspot',
      action: 'mock_hubspot_school_seeded',
      message: `${session.user.email} seeded mock HubSpot school data for ${schoolName}.`,
      entityType: 'client_profile',
      entityId: profile.id,
      schoolName,
      clientEmail: profile.primaryContactEmail,
      metadata: {
        services: profile.services,
        clientType: profile.clientType,
        onboardingStartDate: profile.onboardingStartDate,
        hubspotCompanyId: profile.hubspotCompanyId,
        hubspotDealId: profile.hubspotDealId,
      },
    })

    const asanaProject = await provisionAsanaProjectForSchool(schoolName)

    return {
      schoolName,
      primaryContactEmail: profile.primaryContactEmail,
      asanaProject,
    }
  })

export const Route = createFileRoute('/admin-integrations')({
  beforeLoad: async ({ location }) => {
    const access = await getAdminIntegrationsAccess()

    if (!access.isSignedIn) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }

    if (!access.isAdmin) {
      throw redirect({
        to: '/vertex-dashboard',
      })
    }
  },
  loader: async () => await getIntegrationsStatus(),
  component: AdminIntegrationsPage,
})

function AdminIntegrationsPage() {
  const { asana, hubspot } = Route.useLoaderData()
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isSavingCredentials, setIsSavingCredentials] = useState(false)
  const [isClearingCredentials, setIsClearingCredentials] = useState(false)
  const [clientId, setClientId] = useState(asana.storedClientId || '')
  const [clientSecret, setClientSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState(asana.redirectUri || '')
  const [message, setMessage] = useState<string | null>(null)
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)
  const [isLoadingTeams, setIsLoadingTeams] = useState(false)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [templateMessage, setTemplateMessage] = useState<string | null>(null)
  const [templateWorkspaceGid, setTemplateWorkspaceGid] = useState(asana.workspaceGid || '')
  const [templateTeamGid, setTemplateTeamGid] = useState(asana.teamGid || '')
  const [teamOptions, setTeamOptions] = useState<AsanaTeamOption[]>([])
  const [templateOptions, setTemplateOptions] = useState<AsanaTemplateOption[]>([])
  const [selectedTemplateGid, setSelectedTemplateGid] = useState(asana.projectTemplateGid || '')
  const [selectedTemplateName, setSelectedTemplateName] = useState(asana.projectTemplateName || '')
  const [savedTemplateGid, setSavedTemplateGid] = useState(asana.projectTemplateGid || '')
  const [savedTemplateSource, setSavedTemplateSource] = useState(asana.projectSettingsSource || '')
  const [isSeedingSchool, setIsSeedingSchool] = useState(false)
  const [seedMessage, setSeedMessage] = useState<string | null>(null)
  const [seedSchoolName, setSeedSchoolName] = useState('Mock Academy')
  const [seedState, setSeedState] = useState('California')
  const [seedServices, setSeedServices] = useState('SFO (Accounting, AP, Payroll)')
  const [seedClientType, setSeedClientType] = useState('New')
  const [seedContactName, setSeedContactName] = useState('Jordan Lee')
  const [seedContactEmail, setSeedContactEmail] = useState('jordan.lee@mockacademy.example')
  const [seedCoordinator, setSeedCoordinator] = useState('Vertex onboarding team')
  const [seedStartDate, setSeedStartDate] = useState('2026-08-15')
  const selectedTemplateIsSaved = Boolean(savedTemplateGid && selectedTemplateGid === savedTemplateGid)
  const currentTemplateSource = selectedTemplateGid
    ? selectedTemplateIsSaved
      ? savedTemplateSource
      : 'unsaved selection'
    : savedTemplateSource

  function applySeedPreset(school: MockSeedSchool) {
    setSeedSchoolName(school.schoolName)
    setSeedState(school.state)
    setSeedServices(school.services)
    setSeedClientType(school.clientType)
    setSeedContactName(school.primaryContactName)
    setSeedContactEmail(school.primaryContactEmail)
    setSeedCoordinator(school.onboardingCoordinator)
    setSeedStartDate(school.onboardingStartDate)
    setSeedMessage(null)
  }

  async function disconnectAsana() {
    setIsDisconnecting(true)
    try {
      const response = await fetch('/api/asana/oauth/disconnect', {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error('Disconnect failed')
      }
      window.location.href = '/admin-integrations?asana=disconnected'
    } catch (err) {
      console.error(err)
      setIsDisconnecting(false)
      window.location.href = '/admin-integrations?asana=disconnect-failed'
    }
  }

  async function saveCredentials(event: FormEvent) {
    event.preventDefault()
    setIsSavingCredentials(true)
    setMessage(null)

    try {
      await saveAsanaCredentials({
        data: {
          clientId,
          clientSecret,
          redirectUri,
        },
      })
      window.location.href = '/admin-integrations?asana=settings-saved'
    } catch (err: any) {
      setMessage(err?.message || 'Could not save Asana OAuth credentials.')
      setIsSavingCredentials(false)
    }
  }

  async function clearCredentials() {
    if (!confirm('Clear saved Asana OAuth credentials and disconnect Asana?')) {
      return
    }

    setIsClearingCredentials(true)
    setMessage(null)

    try {
      await clearAsanaCredentials()
      window.location.href = '/admin-integrations?asana=settings-cleared'
    } catch (err: any) {
      setMessage(err?.message || 'Could not clear Asana OAuth credentials.')
      setIsClearingCredentials(false)
    }
  }

  async function loadTemplates() {
    setIsLoadingTemplates(true)
    setTemplateMessage(null)

    try {
      const selectedTeam = teamOptions.find(team => team.gid === templateTeamGid)
      const result = await loadAsanaTemplates({
        data: {
          workspaceGid: templateWorkspaceGid,
          teamGid: templateTeamGid,
          teamName: selectedTeam?.name || '',
        },
      })
      setTemplateOptions(result.templates)
      setTemplateWorkspaceGid(result.workspaceGid || templateWorkspaceGid)
      setTemplateTeamGid(result.teamGid || templateTeamGid)
      if (result.templates.length === 0) {
        setTemplateMessage(result.loadedFrom === 'organization_teams'
          ? `Checked ${result.teams?.length || 0} visible teams. No project templates were found.${result.failedTeams?.length ? ` ${result.failedTeams.length} teams could not be checked.` : ''}`
          : 'No project templates were found for that workspace or team.')
      } else {
        const current = result.templates.find(template => template.gid === selectedTemplateGid) || result.templates[0]
        setSelectedTemplateGid(current.gid)
        setSelectedTemplateName(current.name)
        if (current.workspaceGid) setTemplateWorkspaceGid(current.workspaceGid)
        if (current.teamGid) setTemplateTeamGid(current.teamGid)
        setTemplateMessage(result.loadedFrom === 'organization_teams'
          ? `Loaded ${result.templates.length} project templates across ${result.teams?.length || 0} visible teams.${result.failedTeams?.length ? ` ${result.failedTeams.length} teams could not be checked.` : ''}`
          : `Loaded ${result.templates.length} project templates.`)
      }
    } catch (err: any) {
      setTemplateMessage(err?.message || 'Could not load Asana project templates.')
    } finally {
      setIsLoadingTemplates(false)
    }
  }

  async function loadTeams() {
    setIsLoadingTeams(true)
    setTemplateMessage(null)

    try {
      const result = await loadAsanaTeams({
        data: {
          workspaceGid: templateWorkspaceGid,
        },
      })
      setTeamOptions(result.teams)
      setTemplateWorkspaceGid(result.workspaceGid || templateWorkspaceGid)
      if (result.teams.length === 0) {
        setTemplateMessage('No teams were found for that Asana organization or workspace.')
      } else {
        const currentTeam = result.teams.find(team => team.gid === templateTeamGid) || result.teams[0]
        setTemplateTeamGid(currentTeam.gid)
        setTemplateMessage(`Loaded ${result.teams.length} teams from Asana. Choose a team, then load templates.`)
      }
    } catch (err: any) {
      setTemplateMessage(err?.message || 'Could not load Asana teams.')
    } finally {
      setIsLoadingTeams(false)
    }
  }

  async function saveTemplateSelection(event: FormEvent) {
    event.preventDefault()
    setIsSavingTemplate(true)
    setTemplateMessage(null)

    try {
      const selected = templateOptions.find(template => template.gid === selectedTemplateGid)
      const projectTemplateName = selected?.name || selectedTemplateName
      await saveAsanaTemplateSelection({
        data: {
          projectTemplateGid: selectedTemplateGid,
          projectTemplateName,
          workspaceGid: selected?.workspaceGid || templateWorkspaceGid,
          teamGid: selected?.teamGid || templateTeamGid,
        },
      })
      setSelectedTemplateName(projectTemplateName)
      setSavedTemplateGid(selectedTemplateGid)
      setSavedTemplateSource('saved')
      setTemplateMessage(`Saved "${projectTemplateName}" as the school onboarding template.`)
    } catch (err: any) {
      setTemplateMessage(err?.message || 'Could not save Asana project template selection.')
    } finally {
      setIsSavingTemplate(false)
    }
  }

  async function seedSchool(event: FormEvent) {
    event.preventDefault()
    setIsSeedingSchool(true)
    setSeedMessage(null)

    try {
      const result = await seedMockHubSpotSchool({
        data: {
          schoolName: seedSchoolName,
          state: seedState,
          services: seedServices,
          clientType: seedClientType,
          primaryContactName: seedContactName,
          primaryContactEmail: seedContactEmail,
          onboardingCoordinator: seedCoordinator,
          onboardingStartDate: seedStartDate,
        },
      })
      const status = result.asanaProject.status === 'ready'
        ? `Asana project is ready: ${result.asanaProject.projectName}.`
        : result.asanaProject.status === 'failed'
          ? `Asana project creation failed: ${result.asanaProject.lastError || 'Unknown Asana error'}.`
          : `Asana project creation started: ${result.asanaProject.projectName}. Refresh task retrieval shortly if it is still creating.`
      setSeedMessage(`Seeded ${result.schoolName} into D1. ${status}`)
    } catch (err: any) {
      setSeedMessage(err?.message || 'Could not seed mock school data.')
    } finally {
      setIsSeedingSchool(false)
    }
  }

  return (
    <main className="page-wrap page-shell">
      <div className="page-stack page-stack-standard page-section-gap">
        <div className="page-heading">
          <div className="page-kicker">
            Admin
          </div>
          <h1 className="page-title">
            Integrations
          </h1>
        </div>

        <section className="island-shell rounded-2xl p-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="mb-2 font-display text-xl font-bold text-[var(--vertex-blue)]">
                Asana
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-[var(--sea-ink-soft)]">
                Connect the portal to Asana so each school can get its own onboarding project from the configured template. Uploaded client documents complete the matching task and add a completion comment.
              </p>
            </div>
            <StatusPill connected={asana.isConnected} />
          </div>

          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <InfoTile label="OAuth2 app credentials" value={asana.isConfigured ? 'Configured' : 'Missing'}>
              {asana.configSource === 'admin'
                ? 'Using the Client ID and Client Secret saved from this screen.'
                : asana.configSource === 'environment'
                  ? 'Using Cloudflare environment credentials.'
                  : 'Save the OAuth2 Client ID and Client Secret before connecting.'}
            </InfoTile>
            <InfoTile label="Connected by" value={asana.connectedByName || asana.connectedByEmail || 'None'}>
              {asana.connectedAt ? `Connected ${new Date(asana.connectedAt).toLocaleString()}` : null}
            </InfoTile>
            <InfoTile
              label="Template access"
              value={!asana.isConnected ? 'Not connected' : asana.hasProjectTemplatesReadScope && asana.hasTeamsReadScope && asana.hasJobsReadScope && asana.hasCustomFieldsReadScope ? 'Ready' : 'Reconnect needed'}
            >
              {asana.isConnected && (!asana.hasProjectTemplatesReadScope || !asana.hasTeamsReadScope || !asana.hasJobsReadScope || !asana.hasCustomFieldsReadScope)
                ? 'Reconnect Asana to grant project_templates:read, teams:read, jobs:read, and custom_fields:read.'
                : 'Required for loading templates and confirming project creation.'}
            </InfoTile>
            <InfoTile
              label="Token source"
              value={asana.activeTokenSource === 'oauth'
                ? 'OAuth'
                : asana.activeTokenSource === 'personal_access_token'
                  ? 'PAT fallback'
                  : 'None'}
            >
              {asana.hasPersonalAccessToken
                ? 'ASANA_PAT is configured, but OAuth is used when connected.'
                : 'No ASANA_PAT fallback is configured.'}
            </InfoTile>
          </div>

          <form onSubmit={saveCredentials} className="mt-5 rounded-xl border border-[var(--chip-line)] bg-white p-4">
            <div className="mb-4">
              <h3 className="font-display text-base font-bold text-[var(--vertex-blue)]">
                OAuth2 app credentials
              </h3>
              <p className="mt-1 text-sm leading-6 text-[var(--sea-ink-soft)]">
                Enter the Client ID and Client Secret from the Asana OAuth app. Saved credentials are encrypted in D1 and override Cloudflare environment credentials. Saving new credentials disconnects the current Asana account until you reconnect.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                OAuth2 Client ID
                <input
                  type="text"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  required
                  autoComplete="off"
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>

              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                OAuth2 Client Secret
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder={asana.hasStoredCredentials ? 'Enter a new client secret to replace the saved one' : 'Paste the Asana OAuth2 client secret'}
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>
            </div>

            <label className="mt-4 block text-sm font-semibold text-[var(--sea-ink)]">
              Redirect URL
              <input
                type="url"
                value={redirectUri}
                onChange={(event) => setRedirectUri(event.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
              />
            </label>

            {message ? (
              <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {message}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={isSavingCredentials}
                className="inline-flex justify-center rounded-full bg-[var(--vertex-blue)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)] disabled:opacity-60"
              >
                {isSavingCredentials ? 'Saving...' : 'Save OAuth2 credentials'}
              </button>
              {asana.hasStoredCredentials ? (
                <button
                  type="button"
                  onClick={clearCredentials}
                  disabled={isClearingCredentials}
                  className="inline-flex justify-center rounded-full border border-[var(--chip-line)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)] disabled:opacity-60"
                >
                  {isClearingCredentials ? 'Clearing...' : 'Clear saved credentials'}
                </button>
              ) : null}
            </div>
          </form>

          <div className="mt-4 rounded-xl border border-[var(--chip-line)] bg-white p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--sea-ink-soft)]">
              Asana redirect URL
            </div>
            <code className="mt-2 block overflow-x-auto rounded-lg bg-[var(--foam)] px-3 py-2 text-xs text-[var(--vertex-blue)]">
              {asana.redirectUri}
            </code>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <a
              href="/api/asana/oauth/start?returnTo=/admin-integrations"
              className={`inline-flex justify-center rounded-full px-5 py-2.5 text-sm font-bold text-white no-underline transition ${
                asana.isConfigured
                  ? 'bg-[var(--vertex-blue)] hover:bg-[var(--lagoon-deep)]'
                  : 'pointer-events-none bg-slate-400'
              }`}
            >
              {asana.isConnected ? 'Reconnect Asana' : 'Connect Asana'}
            </a>
            {asana.isConnected ? (
              <button
                type="button"
                onClick={disconnectAsana}
                disabled={isDisconnecting}
                className="inline-flex justify-center rounded-full border border-[var(--chip-line)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)] disabled:opacity-60"
              >
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : null}
          </div>

          <form onSubmit={saveTemplateSelection} className="mt-5 rounded-xl border border-[var(--chip-line)] bg-white p-4">
            <div className="mb-4">
              <h3 className="font-display text-base font-bold text-[var(--vertex-blue)]">
                School project template
              </h3>
              <p className="mt-1 text-sm leading-6 text-[var(--sea-ink-soft)]">
                Select the Asana project template that should be used whenever a new school onboarding project is created. For Asana organizations, enter the organization GID as Workspace GID and the portal will load templates from visible teams.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                Workspace GID
                <input
                  type="text"
                  value={templateWorkspaceGid}
                  onChange={(event) => {
                    setTemplateWorkspaceGid(event.target.value)
                    setTeamOptions([])
                    setTemplateOptions([])
                  }}
                  placeholder="Workspace or organization GID"
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>

              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                Team filter
                {teamOptions.length > 0 ? (
                  <select
                    value={templateTeamGid}
                    onChange={(event) => {
                      setTemplateTeamGid(event.target.value)
                      setTemplateOptions([])
                    }}
                    className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                  >
                    {teamOptions.map((team) => (
                      <option key={team.gid} value={team.gid}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={templateTeamGid}
                    onChange={(event) => {
                      setTemplateTeamGid(event.target.value)
                      setTemplateOptions([])
                    }}
                    placeholder="Optional Team GID"
                    className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                  />
                )}
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={loadTeams}
                disabled={isLoadingTeams || !asana.isConnected || !templateWorkspaceGid.trim()}
                className="inline-flex justify-center rounded-full border border-[var(--chip-line)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)] disabled:opacity-60"
              >
                {isLoadingTeams ? 'Loading teams...' : 'Load teams'}
              </button>
              <button
                type="button"
                onClick={loadTemplates}
                disabled={isLoadingTemplates || isLoadingTeams || !asana.isConnected}
                className="inline-flex justify-center rounded-full border border-[var(--chip-line)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)] disabled:opacity-60"
              >
                {isLoadingTemplates ? 'Loading templates...' : templateTeamGid ? 'Load templates for team' : 'Load templates'}
              </button>
              {!asana.isConnected ? (
                <span className="self-center text-xs font-semibold text-[var(--sea-ink-soft)]">
                  Connect Asana before loading templates.
                </span>
              ) : templateWorkspaceGid.trim() && teamOptions.length === 0 ? (
                <span className="self-center text-xs font-semibold text-[var(--sea-ink-soft)]">
                  Load teams first when using an organization GID.
                </span>
              ) : null}
            </div>

            <label className="mt-4 block text-sm font-semibold text-[var(--sea-ink)]">
              Project template
              <select
                value={selectedTemplateGid}
                onChange={(event) => {
                  const nextTemplate = templateOptions.find(template => template.gid === event.target.value)
                  setSelectedTemplateGid(event.target.value)
                  setSelectedTemplateName(nextTemplate?.name || '')
                  if (nextTemplate?.workspaceGid) setTemplateWorkspaceGid(nextTemplate.workspaceGid)
                  if (nextTemplate?.teamGid) setTemplateTeamGid(nextTemplate.teamGid)
                }}
                disabled={templateOptions.length === 0}
                className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)] disabled:opacity-60"
              >
                {selectedTemplateGid && templateOptions.length === 0 ? (
                  <option value={selectedTemplateGid}>{selectedTemplateName || selectedTemplateGid}</option>
                ) : null}
                {templateOptions.length === 0 && !selectedTemplateGid ? (
                  <option value="">Load templates to choose one</option>
                ) : null}
                {templateOptions.map((template) => (
                  <option key={template.gid} value={template.gid}>
                    {template.teamName ? `${template.name} - ${template.teamName}` : template.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-3 rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] p-3 text-xs font-semibold text-[var(--sea-ink-soft)]">
              Current template: {selectedTemplateName || asana.projectTemplateName || selectedTemplateGid || 'None selected'}
              {currentTemplateSource ? ` (${currentTemplateSource})` : ''}
            </div>

            {templateMessage ? (
              <p className="mt-3 rounded-xl bg-[var(--foam)] px-4 py-3 text-sm font-semibold text-[var(--sea-ink)]">
                {templateMessage}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={isSavingTemplate || !selectedTemplateGid}
                className="inline-flex justify-center rounded-full bg-[var(--vertex-blue)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)] disabled:opacity-60"
              >
                {isSavingTemplate ? 'Saving...' : 'Save project template'}
              </button>
            </div>
          </form>
        </section>

        <section className="island-shell rounded-2xl p-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="mb-2 font-display text-xl font-bold text-[var(--vertex-blue)]">
                HubSpot
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-[var(--sea-ink-soft)]">
                HubSpot is represented by a mock integration for this demo. Client profile, company, and deal references stay available without calling HubSpot APIs.
              </p>
            </div>
            <StatusPill connected={hubspot.isConnected} label="Connected" />
          </div>

          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <InfoTile label="Mode" value={hubspot.mode}>
              No external HubSpot credentials required.
            </InfoTile>
            <InfoTile label="Connected by" value={hubspot.connectedByName}>
              Connected {new Date(hubspot.connectedAt).toLocaleDateString()}
            </InfoTile>
            <InfoTile label="Data source" value="Demo fixtures">
              {hubspot.description}
            </InfoTile>
          </div>

          <form onSubmit={seedSchool} className="mt-5 rounded-xl border border-[var(--chip-line)] bg-white p-4">
            <div className="mb-4">
              <h3 className="font-display text-base font-bold text-[var(--vertex-blue)]">
                Seed Mock HubSpot School
              </h3>
              <p className="mt-1 text-sm leading-6 text-[var(--sea-ink-soft)]">
                Inserts a HubSpot-style school profile into D1, then triggers the same Asana project creation flow used when onboarding tasks are requested.
              </p>
            </div>

            <label className="mb-4 block text-sm font-semibold text-[var(--sea-ink)]">
              Test school preset
              <select
                value={seedSchoolName}
                onChange={(event) => {
                  const preset = mockSeedSchools.find(school => school.schoolName === event.target.value)
                  if (preset) applySeedPreset(preset)
                }}
                className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
              >
                {mockSeedSchools.map((school) => (
                  <option key={school.schoolName} value={school.schoolName}>
                    {school.schoolName} - {school.state} - {school.clientType}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                School name
                <input
                  type="text"
                  value={seedSchoolName}
                  onChange={(event) => setSeedSchoolName(event.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>

              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                State
                <input
                  type="text"
                  value={seedState}
                  onChange={(event) => setSeedState(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>

              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                Services
                <input
                  type="text"
                  value={seedServices}
                  onChange={(event) => setSeedServices(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>

              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                Client type
                <select
                  value={seedClientType}
                  onChange={(event) => setSeedClientType(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                >
                  {CLIENT_TYPES.map((clientType) => (
                    <option key={clientType} value={clientType}>{clientType}</option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                Primary contact name
                <input
                  type="text"
                  value={seedContactName}
                  onChange={(event) => setSeedContactName(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>

              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                Primary contact email
                <input
                  type="email"
                  value={seedContactEmail}
                  onChange={(event) => setSeedContactEmail(event.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>

              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                Onboarding coordinator
                <input
                  type="text"
                  value={seedCoordinator}
                  onChange={(event) => setSeedCoordinator(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>

              <label className="block text-sm font-semibold text-[var(--sea-ink)]">
                Onboarding start date
                <input
                  type="date"
                  value={seedStartDate}
                  onChange={(event) => setSeedStartDate(event.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-normal text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                />
              </label>
            </div>

            {seedMessage ? (
              <p className="mt-3 rounded-xl bg-[var(--foam)] px-4 py-3 text-sm font-semibold text-[var(--sea-ink)]">
                {seedMessage}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={isSeedingSchool}
                className="inline-flex justify-center rounded-full bg-[var(--vertex-blue)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)] disabled:opacity-60"
              >
                {isSeedingSchool ? 'Seeding...' : 'Seed school and trigger Asana'}
              </button>
            </div>
          </form>
        </section>

        <div>
          <Link
            to="/admin-settings"
            className="inline-flex rounded-full border border-[var(--chip-line)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--vertex-blue)] no-underline transition hover:bg-[var(--foam)]"
          >
            Back to Admin Settings
          </Link>
        </div>
      </div>
    </main>
  )
}

function StatusPill({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold ${
      connected
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-amber-50 text-amber-800'
    }`}>
      {label || (connected ? 'Connected' : 'Not connected')}
    </span>
  )
}

function InfoTile({ label, value, children }: { label: string; value: string; children?: string | null }) {
  return (
    <div className="rounded-xl border border-[var(--chip-line)] bg-white p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-[var(--sea-ink-soft)]">
        {label}
      </div>
      <div className="mt-1 font-bold text-[var(--vertex-blue)]">
        {value}
      </div>
      {children ? (
        <p className="mt-2 leading-6 text-[var(--sea-ink-soft)]">
          {children}
        </p>
      ) : null}
    </div>
  )
}
