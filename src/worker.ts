import serverEntry from '@tanstack/react-start/server-entry'
import { sendScheduledTaskNudges } from './lib/scheduled-nudges'

export default {
  fetch: serverEntry.fetch,

  async scheduled(
    controller: { scheduledTime: number },
    _env: unknown,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    ctx.waitUntil(sendScheduledTaskNudges(controller.scheduledTime))
  },
}
