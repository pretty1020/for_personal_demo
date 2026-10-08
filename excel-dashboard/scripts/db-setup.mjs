import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from '@neondatabase/serverless'
import bcrypt from 'bcryptjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const DEMO_USERS = [
  {
    email: 'admin@demo.local',
    password: 'demo',
    name: 'Admin',
    accessLevel: 'executive',
  },
  {
    email: 'demo@demo.local',
    password: 'demo',
    name: 'Demo User',
    accessLevel: 'executive',
  },
]

const REVOKED_DEMO_EMAILS = [
  'admin@wfmcommons.com',
  'demo@wfmcommons.com',
  'demo@capacity.app',
  'user@wfmcommons.com',
  'marian@wfmcommons.com',
  'user02@wfmcommons.com',
  'user01@wfmcommons.com',
  'kouji@wfmcommons.com',
  'manager@capacity.app',
]

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL is required. Set it to your Neon connection string.')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: databaseUrl })
  const schema = readFileSync(join(root, 'db', 'schema.sql'), 'utf8')

  try {
    console.log('Applying schema…')
    await pool.query(schema)
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS ai_assistant_approved BOOLEAN NOT NULL DEFAULT false
    `)

    console.log('Revoking former demo users…')
    for (const email of REVOKED_DEMO_EMAILS) {
      const result = await pool.query(`DELETE FROM users WHERE lower(email) = lower($1)`, [email])
      if (result.rowCount) console.log(`  ✕ removed ${email}`)
    }

    console.log('Seeding admin user…')
    for (const user of DEMO_USERS) {
      const passwordHash = await bcrypt.hash(user.password, 12)
      const aiApproved = user.accessLevel === 'executive'
      await pool.query(
        `
          INSERT INTO users (email, password_hash, name, access_level, ai_assistant_approved)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (email) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              name = EXCLUDED.name,
              access_level = EXCLUDED.access_level,
              ai_assistant_approved = CASE
                WHEN EXCLUDED.access_level = 'executive' THEN true
                ELSE users.ai_assistant_approved
              END
        `,
        [user.email, passwordHash, user.name, user.accessLevel, aiApproved],
      )
      console.log(`  ✓ ${user.email} (${user.accessLevel})`)
    }

    await pool.query(`
      UPDATE users SET ai_assistant_approved = true WHERE access_level = 'executive'
    `)

    console.log('Database setup complete.')
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
