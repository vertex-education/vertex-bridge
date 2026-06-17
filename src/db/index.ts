import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export function getD1Binding() {
  const d1 = (env as any).DB
  if (!d1) {
    throw new Error('D1 database binding "DB" is not available in the environment.')
  }
  return d1
}

export const db = drizzle(getD1Binding(), { schema })
export type AppDb = typeof db
