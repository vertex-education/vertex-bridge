import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { asanaConnections, asanaOAuthSettings, asanaProjectSettings } from '#/db/schema'
import { getCloudflareEnv } from './cloudflare-env.server'
import { getServerRequest } from './security'
import type { AppSession } from './security'

const asanaConnectionId = 'default'
const asanaOAuthSettingsId = 'default'
const asanaProjectSettingsId = 'default'
const oauthStateCookieName = 'vertex_asana_oauth'
const tokenRefreshSkewMs = 60_000
const asanaOAuthScope = 'projects:read projects:write project_templates:read teams:read jobs:read tasks:read tasks:write stories:write custom_fields:read'
const projectTemplatesScope = 'project_templates:read'
const teamsReadScope = 'teams:read'
const jobsReadScope = 'jobs:read'
const customFieldsReadScope = 'custom_fields:read'
const asanaRequestTimeoutMs = 15_000

type AsanaOAuthState = {
  state: string
  codeVerifier: string
  userId: string
  returnTo: string
  expiresAt: number
}

type AsanaTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  data?: {
    gid?: string
    name?: string
    email?: string
  }
}

function getEnvValue(name: string) {
  const env = getCloudflareEnv()
  const processEnv = (globalThis as any).process?.env
  return (env as any)[name] || (env as any).vars?.[name] || processEnv?.[name]
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function getAsanaOAuthConfig(request: Request) {
  const savedSettings = await getStoredAsanaOAuthSettings()
  const clientId = savedSettings?.clientId || getEnvValue('ASANA_CLIENT_ID')
  let clientSecret = getEnvValue('ASANA_CLIENT_SECRET')
  if (savedSettings) {
    try {
      clientSecret = await decryptClientSecret(savedSettings.encryptedClientSecret)
    } catch (err) {
      console.error('Failed to decrypt saved Asana OAuth secret:', err)
      clientSecret = ''
    }
  }
  const configuredRedirectUri = savedSettings?.redirectUri || getEnvValue('ASANA_REDIRECT_URI')
  const origin = new URL(request.url).origin

  return {
    clientId,
    clientSecret,
    redirectUri: configuredRedirectUri || `${origin}/api/asana/oauth/callback`,
    isConfigured: Boolean(clientId && clientSecret),
    source: savedSettings ? 'admin' : clientId || clientSecret ? 'environment' : 'missing',
    hasStoredCredentials: Boolean(savedSettings),
    storedClientId: savedSettings?.clientId || null,
    updatedByEmail: savedSettings?.updatedByEmail || null,
    updatedAt: savedSettings?.updatedAt?.toISOString() || null,
  }
}

export async function getAsanaConnectionStatus(request: Request) {
  const config = await getAsanaOAuthConfig(request)
  const connection = await getStoredAsanaConnection()
  const projectSettings = await getStoredAsanaProjectSettings()
  const connectedScope = connection?.scope || ''
  const hasEnvPat = Boolean(getEnvValue('ASANA_PAT'))

  return {
    isConfigured: config.isConfigured,
    configSource: config.source,
    hasStoredCredentials: config.hasStoredCredentials,
    storedClientId: config.storedClientId,
    settingsUpdatedByEmail: config.updatedByEmail,
    settingsUpdatedAt: config.updatedAt,
    redirectUri: config.redirectUri,
    isConnected: Boolean(connection),
    connectedByEmail: connection?.connectedByEmail || null,
    connectedByName: connection?.connectedByName || null,
    connectedAt: connection?.connectedAt?.toISOString() || null,
    updatedAt: connection?.updatedAt?.toISOString() || null,
    accessTokenExpiresAt: connection?.accessTokenExpiresAt?.toISOString() || null,
    connectedScope: connection?.scope || null,
    hasProjectTemplatesReadScope: connectedScope.split(/\s+/).includes(projectTemplatesScope),
    hasTeamsReadScope: connectedScope.split(/\s+/).includes(teamsReadScope),
    hasJobsReadScope: connectedScope.split(/\s+/).includes(jobsReadScope),
    hasCustomFieldsReadScope: connectedScope.split(/\s+/).includes(customFieldsReadScope),
    hasPersonalAccessToken: hasEnvPat,
    activeTokenSource: connection ? 'oauth' : hasEnvPat ? 'personal_access_token' : 'none',
    projectTemplateGid: projectSettings?.projectTemplateGid || getEnvValue('ASANA_PROJECT_TEMPLATE_GID') || null,
    projectTemplateName: projectSettings?.projectTemplateName || null,
    workspaceGid: projectSettings?.workspaceGid || getEnvValue('ASANA_WORKSPACE_GID') || null,
    teamGid: projectSettings?.teamGid || getEnvValue('ASANA_TEAM_GID') || null,
    projectSettingsSource: projectSettings ? 'admin' : getEnvValue('ASANA_PROJECT_TEMPLATE_GID') ? 'environment' : 'missing',
    projectSettingsUpdatedByEmail: projectSettings?.updatedByEmail || null,
    projectSettingsUpdatedAt: projectSettings?.updatedAt?.toISOString() || null,
  }
}

export async function createAsanaAuthorizationResponse(request: Request, session: AppSession) {
  const config = await getAsanaOAuthConfig(request)
  if (!config.isConfigured) {
    return redirectWithStatus(request, '/admin-integrations?asana=missing-config')
  }

  const url = new URL(request.url)
  const returnTo = safeReturnPath(url.searchParams.get('returnTo')) || '/admin-integrations'
  const statePayload: AsanaOAuthState = {
    state: randomBase64Url(32),
    codeVerifier: randomBase64Url(64),
    userId: session.user.id,
    returnTo,
    expiresAt: Date.now() + 10 * 60_000,
  }
  const codeChallenge = await sha256Base64Url(statePayload.codeVerifier)
  const authUrl = new URL('https://app.asana.com/-/oauth_authorize')

  authUrl.searchParams.set('client_id', config.clientId)
  authUrl.searchParams.set('redirect_uri', config.redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', statePayload.state)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('scope', asanaOAuthScope)

  const { recordAuditEvent } = await import('./audit')
  await recordAuditEvent({
    session,
    request,
    surface: 'admin',
    category: 'oauth',
    action: 'asana_oauth_started',
    message: `${session.user.email} started Asana OAuth authorization.`,
    entityType: 'asana_connection',
    metadata: {
      returnTo,
      scope: asanaOAuthScope,
      configSource: config.source,
    },
  })

  return redirectResponse(authUrl.toString(), {
    'Set-Cookie': serializeOAuthCookie(request, statePayload),
  })
}

export async function handleAsanaOAuthCallback(request: Request, session: AppSession) {
  const config = await getAsanaOAuthConfig(request)
  if (!config.isConfigured) {
    return redirectWithStatus(request, '/admin-integrations?asana=missing-config')
  }

  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  if (error) {
    return redirectWithStatus(request, `/admin-integrations?asana=${encodeURIComponent(error)}`)
  }

  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const storedState = parseOAuthCookie(request)

  if (!code || !returnedState || !storedState || storedState.expiresAt < Date.now()) {
    return redirectWithStatus(request, '/admin-integrations?asana=invalid-state')
  }

  if (storedState.state !== returnedState || storedState.userId !== session.user.id) {
    return redirectWithStatus(request, '/admin-integrations?asana=invalid-state')
  }

  const token = await exchangeAsanaToken({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
    code_verifier: storedState.codeVerifier,
  })

  if (!token.refresh_token) {
    return redirectWithStatus(request, '/admin-integrations?asana=missing-refresh-token')
  }

  await saveAsanaConnection(token, session, undefined, asanaOAuthScope)

  const { recordAuditEvent } = await import('./audit')
  await recordAuditEvent({
    session,
    request,
    surface: 'admin',
    category: 'oauth',
    action: 'asana_oauth_connected',
    message: `${session.user.email} connected Asana OAuth.`,
    entityType: 'asana_connection',
    entityId: asanaConnectionId,
    metadata: {
      scope: token.scope || null,
      expiresInSeconds: token.expires_in,
      asanaUserEmail: token.data?.email || null,
      asanaUserName: token.data?.name || null,
    },
  })

  return redirectResponse(new URL(`${storedState.returnTo}?asana=connected`, request.url).toString(), {
    'Set-Cookie': clearOAuthCookie(),
  })
}

export async function disconnectAsana() {
  await db.delete(asanaConnections).where(eq(asanaConnections.id, asanaConnectionId))
}

export async function saveAsanaOAuthSettings({ data }: {
  data: {
    clientId: string
    clientSecret: string
    redirectUri?: string
  }
}) {
  const { assertTrustedOrigin, requireStaffSession } = await import('./security')
  await assertTrustedOrigin()
  const session = await requireStaffSession()
  const clientId = data.clientId.trim()
  const clientSecret = data.clientSecret.trim()
  const redirectUri = data.redirectUri?.trim() || null

  if (!clientId || !clientSecret) {
    throw new Error('Client ID and client secret are required.')
  }

  if (redirectUri && !redirectUri.startsWith('https://') && !redirectUri.startsWith('http://localhost')) {
    throw new Error('Redirect URI must be HTTPS, except localhost during development.')
  }

  const now = new Date()
  const encryptedClientSecret = await encryptClientSecret(clientSecret)

  await db
    .insert(asanaOAuthSettings)
    .values({
      id: asanaOAuthSettingsId,
      clientId,
      encryptedClientSecret,
      redirectUri,
      updatedByUserId: session.user.id,
      updatedByEmail: session.user.email,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: asanaOAuthSettings.id,
      set: {
        clientId,
        encryptedClientSecret,
        redirectUri,
        updatedByUserId: session.user.id,
        updatedByEmail: session.user.email,
        updatedAt: now,
      },
    })

  await disconnectAsana()

  const { recordAuditEvent } = await import('./audit')
  await recordAuditEvent({
    session,
    request: await getServerRequest(),
    surface: 'admin',
    category: 'oauth',
    action: 'asana_oauth_settings_saved',
    message: `${session.user.email} saved Asana OAuth2 app credentials.`,
    entityType: 'asana_oauth_settings',
    entityId: asanaOAuthSettingsId,
    metadata: {
      clientId,
      redirectUri,
      disconnectedExistingConnection: true,
    },
  })

  return { ok: true }
}

export async function clearAsanaOAuthSettings() {
  const { assertTrustedOrigin, requireStaffSession } = await import('./security')
  await assertTrustedOrigin()
  const session = await requireStaffSession()
  await disconnectAsana()
  await db.delete(asanaOAuthSettings).where(eq(asanaOAuthSettings.id, asanaOAuthSettingsId))

  const { recordAuditEvent } = await import('./audit')
  await recordAuditEvent({
    session,
    request: await getServerRequest(),
    surface: 'admin',
    category: 'oauth',
    action: 'asana_oauth_settings_cleared',
    message: `${session.user.email} cleared Asana OAuth2 app credentials.`,
    entityType: 'asana_oauth_settings',
    entityId: asanaOAuthSettingsId,
    metadata: {
      disconnectedExistingConnection: true,
    },
  })

  return { ok: true }
}

export async function getAsanaProjectTemplateSettings() {
  const savedSettings = await getStoredAsanaProjectSettings()

  return {
    templateGid: savedSettings?.projectTemplateGid || getEnvValue('ASANA_PROJECT_TEMPLATE_GID') || '',
    templateName: savedSettings?.projectTemplateName || '',
    workspaceGid: savedSettings?.workspaceGid || getEnvValue('ASANA_WORKSPACE_GID') || '',
    teamGid: savedSettings?.teamGid || getEnvValue('ASANA_TEAM_GID') || '',
    source: savedSettings ? 'admin' : getEnvValue('ASANA_PROJECT_TEMPLATE_GID') ? 'environment' : 'missing',
  }
}

export async function listAsanaProjectTemplates({ data }: {
  data: {
    workspaceGid?: string
    teamGid?: string
    teamName?: string
  }
}) {
  const { assertTrustedOrigin, requireAdminSession } = await import('./security')
  await assertTrustedOrigin()
  await requireAdminSession()

  const token = await getAsanaBearerToken(await getServerRequest())
  if (!token) {
    throw new Error('Connect Asana before loading project templates.')
  }

  const workspaceGid = data.workspaceGid?.trim() || getEnvValue('ASANA_WORKSPACE_GID') || ''
  const teamGid = data.teamGid?.trim() || getEnvValue('ASANA_TEAM_GID') || ''
  const teamName = data.teamName?.trim() || ''

  if (teamGid) {
    const templates = await fetchAsanaProjectTemplates(token, { workspaceGid, teamGid, fallbackTeamName: teamName })
    return {
      workspaceGid,
      teamGid,
      teams: teamName ? [{ gid: teamGid, name: teamName }] : [],
      failedTeams: [],
      loadedFrom: 'team',
      templates,
    }
  }

  if (!workspaceGid) {
    throw new Error('Enter an Asana workspace or organization GID, or enter a team GID before loading templates.')
  }

  try {
    const templates = await fetchAsanaProjectTemplates(token, { workspaceGid })
    return {
      workspaceGid,
      teamGid,
      loadedFrom: 'workspace',
      teams: [],
      failedTeams: [],
      templates,
    }
  } catch (err: any) {
    if (!String(err?.message || err).includes('requires_workspace_received_organization')) {
      throw err
    }
  }

  const teams = await fetchAsanaTeamsForWorkspace(token, workspaceGid)
  const templates: Array<{
    gid: string
    name: string
    workspaceGid: string
    workspaceName: string
    teamGid: string
    teamName: string
  }> = []
  const failedTeams: Array<{
    gid: string
    name: string
    error: string
  }> = []

  for (const team of teams) {
    try {
      const teamTemplates = await fetchAsanaProjectTemplates(token, {
        workspaceGid,
        teamGid: team.gid,
        fallbackTeamName: team.name,
      })
      templates.push(...teamTemplates)
    } catch (err: any) {
      failedTeams.push({
        gid: team.gid,
        name: team.name,
        error: err?.message || String(err),
      })
    }
  }

  return {
    workspaceGid,
    teamGid,
    loadedFrom: 'organization_teams',
    teams: teams.map((team: any) => ({
      gid: team.gid,
      name: team.name,
    })),
    failedTeams,
    templates,
  }
}

export async function listAsanaTeams({ data }: {
  data: {
    workspaceGid?: string
  }
}) {
  const { assertTrustedOrigin, requireAdminSession } = await import('./security')
  await assertTrustedOrigin()
  await requireAdminSession()

  const token = await getAsanaBearerToken(await getServerRequest())
  if (!token) {
    throw new Error('Connect Asana before loading teams.')
  }

  const workspaceGid = data.workspaceGid?.trim() || getEnvValue('ASANA_WORKSPACE_GID') || ''
  if (!workspaceGid) {
    throw new Error('Enter an Asana organization or workspace GID before loading teams.')
  }

  const teams = await fetchAsanaTeamsForWorkspace(token, workspaceGid)
  return {
    workspaceGid,
    teams: teams.map((team: any) => ({
      gid: team.gid,
      name: team.name,
    })),
  }
}

async function fetchAsanaProjectTemplates(
  token: string,
  options: {
    workspaceGid?: string
    teamGid?: string
    fallbackTeamName?: string
  },
) {
  const params = new URLSearchParams({
    limit: '100',
    opt_fields: 'gid,name',
  })
  if (options.teamGid) {
    params.set('team', options.teamGid)
  } else if (options.workspaceGid) {
    params.set('workspace', options.workspaceGid)
  }

  const templates = await fetchAsanaPaginated(token, `/project_templates?${params.toString()}`, 'Could not load Asana project templates')

  return templates.map((template: any) => ({
    gid: template.gid,
    name: template.name,
    workspaceGid: options.workspaceGid || '',
    workspaceName: '',
    teamGid: options.teamGid || '',
    teamName: options.fallbackTeamName || '',
  }))
}

async function fetchAsanaTeamsForWorkspace(token: string, workspaceGid: string) {
  const params = new URLSearchParams({
    limit: '100',
    opt_fields: 'gid,name',
  })
  return await fetchAsanaPaginated(token, `/workspaces/${workspaceGid}/teams?${params.toString()}`, 'Could not load Asana teams for that organization')
}

async function fetchAsanaPaginated(token: string, path: string, errorPrefix: string) {
  const rows: any[] = []
  let nextPath = path
  const [basePath, query = ''] = path.split('?')
  const params = new URLSearchParams(query)

  while (nextPath) {
    const body = await fetchAsanaJson(token, nextPath, errorPrefix)
    rows.push(...(body.data || []))

    const nextOffset = body.next_page?.offset
    if (!nextOffset) break

    params.set('offset', nextOffset)
    nextPath = `${basePath}?${params.toString()}`
  }

  return rows
}

async function fetchAsanaJson(token: string, path: string, errorPrefix: string) {
  let response = await fetchAsanaWithTimeout(token, path)

  if (response.status >= 500) {
    await sleep(750)
    response = await fetchAsanaWithTimeout(token, path)
  }

  if (!response.ok) {
    const text = await response.text()
    if (response.status === 403 && text.includes(projectTemplatesScope)) {
      throw new Error(`Could not load Asana project templates because the active Asana token is missing ${projectTemplatesScope}. Reconnect Asana from this page so the portal receives the new scope.`)
    }
    if (response.status === 403 && text.includes(teamsReadScope)) {
      throw new Error(`Could not load teams for this Asana organization because the active token is missing ${teamsReadScope}. Reconnect Asana from this page so the portal can discover teams, or enter a Team GID directly.`)
    }
    if (response.status >= 500) {
      throw new Error(`${errorPrefix}: Asana returned a temporary server error after retrying. Try entering a specific Team GID, or retry template loading in a moment. Details: ${text || response.statusText}`)
    }
    throw new Error(`${errorPrefix}: ${response.status} ${text || response.statusText}`)
  }

  return await response.json() as any
}

async function fetchAsanaWithTimeout(token: string, path: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), asanaRequestTimeoutMs)

  try {
    return await fetch(`https://app.asana.com/api/1.0${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Asana did not respond in time. Try selecting a specific team or retry in a moment.')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

export async function saveAsanaProjectTemplateSettings({ data }: {
  data: {
    projectTemplateGid: string
    projectTemplateName: string
    workspaceGid?: string
    teamGid?: string
  }
}) {
  const { assertTrustedOrigin, requireAdminSession } = await import('./security')
  await assertTrustedOrigin()
  const session = await requireAdminSession()
  const projectTemplateGid = data.projectTemplateGid.trim()
  const projectTemplateName = data.projectTemplateName.trim()
  const workspaceGid = data.workspaceGid?.trim() || null
  const teamGid = data.teamGid?.trim() || null

  if (!projectTemplateGid || !projectTemplateName) {
    throw new Error('Select a project template before saving.')
  }
  if (!workspaceGid && !teamGid) {
    throw new Error('Save a workspace GID or team GID with the template.')
  }

  const now = new Date()
  await db
    .insert(asanaProjectSettings)
    .values({
      id: asanaProjectSettingsId,
      projectTemplateGid,
      projectTemplateName,
      workspaceGid,
      teamGid,
      updatedByUserId: session.user.id,
      updatedByEmail: session.user.email,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: asanaProjectSettings.id,
      set: {
        projectTemplateGid,
        projectTemplateName,
        workspaceGid,
        teamGid,
        updatedByUserId: session.user.id,
        updatedByEmail: session.user.email,
        updatedAt: now,
      },
    })
    .run()

  const { recordAuditEvent } = await import('./audit')
  await recordAuditEvent({
    session,
    request: await getServerRequest(),
    surface: 'admin',
    category: 'asana',
    action: 'asana_project_template_selected',
    message: `${session.user.email} selected Asana project template "${projectTemplateName}" for school onboarding.`,
    entityType: 'asana_project_template',
    entityId: projectTemplateGid,
    metadata: {
      workspaceGid,
      teamGid,
    },
  })

  return { ok: true }
}

export async function getAsanaBearerToken(request?: Request, options: { allowPat?: boolean } = {}) {
  const connection = await getStoredAsanaConnection()
  if (!connection) {
    if (options.allowPat === false) return null
    return getEnvValue('ASANA_PAT') || null
  }

  if (connection.accessTokenExpiresAt.getTime() > Date.now() + tokenRefreshSkewMs) {
    return connection.accessToken
  }

  if (!request) return connection.accessToken

  const config = await getAsanaOAuthConfig(request)
  if (!config.isConfigured) return connection.accessToken

  try {
    const refreshed = await exchangeAsanaToken({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: connection.refreshToken,
    })

    await saveAsanaConnection(refreshed, {
      user: {
        id: connection.connectedByUserId,
        email: connection.connectedByEmail,
        name: connection.connectedByName || connection.connectedByEmail,
      },
    } as AppSession, connection.refreshToken, connection.scope || undefined)

    return refreshed.access_token
  } catch (err) {
    console.error('Failed to refresh Asana OAuth token:', err)
    return connection.accessToken
  }
}

async function getStoredAsanaConnection() {
  const rows = await db
    .select()
    .from(asanaConnections)
    .where(eq(asanaConnections.id, asanaConnectionId))
    .limit(1)
    .all()

  return rows[0] || null
}

async function getStoredAsanaOAuthSettings() {
  const rows = await db
    .select()
    .from(asanaOAuthSettings)
    .where(eq(asanaOAuthSettings.id, asanaOAuthSettingsId))
    .limit(1)
    .all()

  return rows[0] || null
}

async function getStoredAsanaProjectSettings() {
  const rows = await db
    .select()
    .from(asanaProjectSettings)
    .where(eq(asanaProjectSettings.id, asanaProjectSettingsId))
    .limit(1)
    .all()

  return rows[0] || null
}

async function saveAsanaConnection(
  token: AsanaTokenResponse,
  session: AppSession,
  fallbackRefreshToken?: string,
  fallbackScope?: string,
) {
  const now = new Date()
  const refreshToken = token.refresh_token || fallbackRefreshToken
  const scope = token.scope || fallbackScope || null
  if (!refreshToken) {
    throw new Error('Asana did not return a refresh token.')
  }

  await db
    .insert(asanaConnections)
    .values({
      id: asanaConnectionId,
      accessToken: token.access_token,
      refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      scope,
      connectedByUserId: session.user.id,
      connectedByEmail: session.user.email,
      connectedByName: session.user.name || token.data?.name || null,
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: asanaConnections.id,
      set: {
        accessToken: token.access_token,
        refreshToken,
        accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
        scope,
        connectedByUserId: session.user.id,
        connectedByEmail: session.user.email,
        connectedByName: session.user.name || token.data?.name || null,
        updatedAt: now,
      },
    })
}

async function exchangeAsanaToken(params: Record<string, string>) {
  const body = new URLSearchParams(params)
  const response = await fetch('https://app.asana.com/-/oauth_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Asana OAuth token exchange failed: ${response.status} ${text}`)
  }

  return await response.json() as AsanaTokenResponse
}

function parseOAuthCookie(request: Request) {
  const cookieHeader = request.headers.get('cookie') || ''
  const cookies = cookieHeader.split(';').map(part => part.trim())
  const cookie = cookies.find(part => part.startsWith(`${oauthStateCookieName}=`))
  if (!cookie) return null

  try {
    return JSON.parse(decodeURIComponent(cookie.slice(oauthStateCookieName.length + 1))) as AsanaOAuthState
  } catch {
    return null
  }
}

function serializeOAuthCookie(request: Request, value: AsanaOAuthState) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${oauthStateCookieName}=${encodeURIComponent(JSON.stringify(value))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`
}

function clearOAuthCookie() {
  return `${oauthStateCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

function redirectWithStatus(request: Request, path: string) {
  return redirectResponse(new URL(path, request.url).toString(), {
    'Set-Cookie': clearOAuthCookie(),
  })
}

function redirectResponse(location: string, headers?: Record<string, string>) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      ...headers,
    },
  })
}

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  return value
}

function randomBase64Url(byteLength: number) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

async function sha256Base64Url(value: string) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToBase64Url(new Uint8Array(digest))
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function getEncryptionKey() {
  const secret = getEnvValue('BETTER_AUTH_SECRET') || getEnvValue('ASANA_SETTINGS_ENCRYPTION_KEY')
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required to store integration secrets.')
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptClientSecret(value: string) {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const key = await getEncryptionKey()
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  )

  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`
}

async function decryptClientSecret(value: string) {
  const [version, ivValue, encryptedValue] = value.split('.')
  if (version !== 'v1' || !ivValue || !encryptedValue) {
    throw new Error('Unsupported Asana client secret format.')
  }

  const key = await getEncryptionKey()
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(ivValue) },
    key,
    base64UrlToBytes(encryptedValue),
  )

  return new TextDecoder().decode(decrypted)
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
