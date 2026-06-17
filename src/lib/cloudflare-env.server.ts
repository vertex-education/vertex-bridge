import { env } from 'cloudflare:workers'

export function getCloudflareEnv() {
  return env as any
}
