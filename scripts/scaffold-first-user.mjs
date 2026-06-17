import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hashPassword } from '@better-auth/utils/password'

const email = process.env.FIRST_USER_EMAIL || 'roger.cormier@vertexeducation.com'
const name = process.env.FIRST_USER_NAME || 'Roger Cormier'
const role = process.env.FIRST_USER_ROLE || 'admin'
const password = process.env.FIRST_USER_PASSWORD || randomBytes(12).toString('base64url')
const d1Dir =
  process.env.D1_STATE_DIR || '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'

function getLocalD1Path() {
  if (!existsSync(d1Dir)) {
    throw new Error(`D1 state directory not found: ${d1Dir}`)
  }

  const candidates = readdirSync(d1Dir)
    .filter((file) => file.endsWith('.sqlite') && file !== 'metadata.sqlite')
    .map((file) => join(d1Dir, file))

  for (const candidate of candidates) {
    const db = new DatabaseSync(candidate)
    try {
      const hasUserTable = db
        .prepare("select 1 from sqlite_master where type = 'table' and name = 'user'")
        .get()
      const hasAccountTable = db
        .prepare("select 1 from sqlite_master where type = 'table' and name = 'account'")
        .get()

      if (hasUserTable && hasAccountTable) {
        return candidate
      }
    } finally {
      db.close()
    }
  }

  throw new Error(`No local D1 SQLite database with auth tables found in ${d1Dir}`)
}

const dbPath = getLocalD1Path()
const db = new DatabaseSync(dbPath)
const now = Date.now()
const passwordHash = await hashPassword(password)

try {
  db.exec('pragma foreign_keys = on')

  const existingUser = db.prepare('select id from user where email = ?').get(email)
  const userId = existingUser?.id || randomUUID()

  if (existingUser) {
    db.prepare(
      'update user set name = ?, email_verified = 1, role = ?, updated_at = ? where id = ?',
    ).run(name, role, now, userId)
  } else {
    db.prepare(
      'insert into user (id, name, email, email_verified, image, role, created_at, updated_at) values (?, ?, ?, 1, null, ?, ?, ?)',
    ).run(userId, name, email, role, now, now)
  }

  const existingAccount = db
    .prepare("select id from account where user_id = ? and provider_id = 'credential'")
    .get(userId)

  if (existingAccount) {
    db.prepare(
      'update account set account_id = ?, password = ?, updated_at = ? where id = ?',
    ).run(userId, passwordHash, now, existingAccount.id)
  } else {
    db.prepare(
      'insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), userId, 'credential', userId, passwordHash, now, now)
  }

  process.stdout.write([
    `Seeded first user in ${dbPath}`,
    `Email: ${email}`,
    `Name: ${name}`,
    `Role: ${role}`,
    `Temporary password: ${password}`,
    '',
  ].join('\n'))
} finally {
  db.close()
}
