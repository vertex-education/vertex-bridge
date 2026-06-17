type NudgeEmailInput = {
  clientEmail: string
  schoolName: string
  contactName: string
  taskName: string
}

export type NudgeEmailRecipient = {
  email: string
  name: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function getEnv() {
  const { getCloudflareEnv } = await import('./cloudflare-env.server')
  return getCloudflareEnv()
}

export async function resolveSchoolNudgeRecipient(schoolName: string): Promise<NudgeEmailRecipient | null> {
  const { db } = await import('#/db')
  const { clientProfiles, invitations, user } = await import('#/db/schema')
  const { and, desc, eq } = await import('drizzle-orm')

  const acceptedInvites = await db
    .select({
      email: invitations.email,
      userName: user.name,
    })
    .from(invitations)
    .leftJoin(user, eq(user.email, invitations.email))
    .where(and(
      eq(invitations.schoolName, schoolName),
      eq(invitations.role, 'school_user'),
      eq(invitations.accepted, true),
    ))
    .orderBy(desc(invitations.createdAt))
    .all()

  const acceptedInvite = acceptedInvites.find((invite) => invite.email)
  if (acceptedInvite?.email) {
    return {
      email: acceptedInvite.email,
      name: acceptedInvite.userName || 'there',
    }
  }

  const profileRows = await db
    .select({
      email: clientProfiles.primaryContactEmail,
      name: clientProfiles.primaryContactName,
    })
    .from(clientProfiles)
    .where(eq(clientProfiles.schoolName, schoolName))
    .limit(1)
    .all()
  const profile = profileRows[0]
  if (profile?.email) {
    return {
      email: profile.email,
      name: profile.name || 'there',
    }
  }

  const inviteRows = await db
    .select({
      email: invitations.email,
    })
    .from(invitations)
    .where(and(
      eq(invitations.schoolName, schoolName),
      eq(invitations.role, 'school_user'),
    ))
    .orderBy(desc(invitations.createdAt))
    .limit(1)
    .all()
  const invite = inviteRows[0]
  if (invite?.email) {
    return {
      email: invite.email,
      name: 'there',
    }
  }

  return null
}

export async function sendNudgeEmailMessage(data: NudgeEmailInput) {
  const env = await getEnv()
  const authUrl = (env as any).BETTER_AUTH_URL || 'http://localhost:3000'
  const link = `${authUrl}/school-onboarding`

  const subject = `Action Required: Onboarding Task for ${data.schoolName}`
  const text = `Hi ${data.contactName},\n\nThis is a friendly nudge from the Vertex onboarding team. Please complete the following onboarding task: "${data.taskName}" as soon as possible.\n\nYou can access your onboarding portal here: ${link}\n\nThank you!\nVertex Education Team`
  const safeContactName = escapeHtml(data.contactName)
  const safeSchoolName = escapeHtml(data.schoolName)
  const safeTaskName = escapeHtml(data.taskName)
  const safeLink = escapeHtml(link)
  const html = `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#f4f6f7; color:#404342; font-family:'DM Sans', Arial, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f7; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; background:#ffffff; border:1px solid rgba(0,56,101,0.12); border-radius:18px; overflow:hidden; box-shadow:0 18px 40px rgba(0,56,101,0.10);">
            <tr>
              <td style="padding:26px 32px 18px 32px; border-bottom:1px solid rgba(0,56,101,0.10);">
                <img src="https://brand.vertexeducation.com/assets/vertex-horizontal.svg" alt="Vertex Education" width="164" style="display:block; max-width:164px; height:auto; margin-bottom:18px;" />
                <div style="font-size:11px; line-height:1.4; letter-spacing:0.16em; text-transform:uppercase; font-weight:700; color:#CBA052;">
                  Vertex Bridge Reminder
                </div>
                <h1 style="margin:8px 0 0 0; font-family:'Red Hat Display', Arial, sans-serif; font-size:28px; line-height:1.14; color:#003865; font-weight:800;">
                  An onboarding step needs your attention.
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 32px 8px 32px;">
                <p style="margin:0 0 16px 0; font-size:16px; line-height:1.7; color:#404342;">
                  Hi ${safeContactName}, the Vertex onboarding team is checking in on ${safeSchoolName}'s onboarding workspace.
                </p>
                <div style="margin:0 0 22px 0; padding:16px 18px; background:#f7fafb; border:1px solid rgba(0,56,101,0.10); border-left:4px solid #CBA052; border-radius:12px;">
                  <div style="font-size:11px; line-height:1.4; letter-spacing:0.12em; text-transform:uppercase; font-weight:800; color:#707372; margin-bottom:6px;">
                    Requested task
                  </div>
                  <div style="font-size:16px; line-height:1.5; color:#003865; font-weight:800;">
                    ${safeTaskName}
                  </div>
                </div>
                <p style="margin:0 0 24px 0; font-size:14px; line-height:1.7; color:#707372;">
                  Please open Vertex Bridge to review the task instructions and upload the requested document when it is ready.
                </p>
                <a href="${safeLink}" style="display:inline-block; background:#003865; color:#ffffff; text-decoration:none; font-size:14px; font-weight:800; padding:14px 22px; border-radius:999px;">
                  Open Onboarding Workspace
                </a>
                <p style="margin:22px 0 0 0; font-size:12px; line-height:1.6; color:#707372;">
                  If the button does not work, copy and paste this link into your browser:<br />
                  <a href="${safeLink}" style="color:#003865; word-break:break-all;">${safeLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 30px 32px;">
                <div style="height:1px; background:rgba(0,56,101,0.10); margin-bottom:18px;"></div>
                <p style="margin:0; font-size:12px; line-height:1.6; color:#707372;">
                  Vertex Education<br />
                  We change lives through education.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const emailSender = (env as any).EMAIL
  if (!emailSender || typeof emailSender.send !== 'function') {
    return { emailSent: false, emailError: 'Cloudflare EMAIL binding not found.' }
  }

  try {
    await emailSender.send({
      to: data.clientEmail,
      from: { email: 'onboarding@rcormier.dev', name: 'Vertex Education' },
      subject,
      text,
      html,
    })
    return { emailSent: true, emailError: '' }
  } catch (e: any) {
    return { emailSent: false, emailError: e?.message || String(e) }
  }
}
