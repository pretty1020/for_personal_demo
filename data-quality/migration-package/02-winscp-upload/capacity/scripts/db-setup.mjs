import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const DEMO_USERS = [
  {
    email: 'test@movate.com',
    password: 'movate',
    name: 'Test User',
    accessLevel: 'admin',
  },
  {
    email: 'ben@movate.com',
    password: 'movate',
    name: 'Ben',
    accessLevel: 'director',
  },
  {
    email: 'marian@movate.com',
    password: 'movate',
    name: 'Marian',
    accessLevel: 'cap_planner',
  },
]

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`${name} is required. Set MariaDB env vars (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD).`)
    process.exit(1)
  }
  return value
}

async function main() {
  const host = requireEnv('DB_HOST')
  const database = requireEnv('DB_NAME')
  const user = requireEnv('DB_USER')
  const password = process.env.DB_PASSWORD ?? ''
  const port = Number(process.env.DB_PORT || '3306')

  const connection = await mysql.createConnection({
    host,
    port: Number.isFinite(port) ? port : 3306,
    database,
    user,
    password,
    multipleStatements: true,
  })

  const schemaPath = join(repoRoot, 'database', 'mariadb', '002_capacity_schema.sql')
  const schema = readFileSync(schemaPath, 'utf8')
  const activeMigrationPath = join(repoRoot, 'database', 'mariadb', '004_capacity_users_active.sql')
  const activeMigration = readFileSync(activeMigrationPath, 'utf8')
  const analystMigrationPath = join(repoRoot, 'database', 'mariadb', '005_capacity_users_analyst.sql')
  const analystMigration = readFileSync(analystMigrationPath, 'utf8')
  const clientsMigrationPath = join(repoRoot, 'database', 'mariadb', '006_capacity_clients.sql')
  const clientsMigration = readFileSync(clientsMigrationPath, 'utf8')
  const documentsMigrationPath = join(repoRoot, 'database', 'mariadb', '007_capacity_documents.sql')
  const documentsMigration = readFileSync(documentsMigrationPath, 'utf8')
  const auditMigrationPath = join(repoRoot, 'database', 'mariadb', '008_capacity_audit_and_settings.sql')
  const auditMigration = readFileSync(auditMigrationPath, 'utf8')
  const dropAiPath = join(repoRoot, 'database', 'mariadb', '009_drop_ai_assistant_column.sql')
  const dropAiMigration = readFileSync(dropAiPath, 'utf8')
  const viewsPath = join(repoRoot, 'database', 'mariadb', '010_capacity_reporting_views.sql')
  const viewsMigration = readFileSync(viewsPath, 'utf8')

  try {
    console.log('Applying Capacity MariaDB schema (002_capacity_schema.sql)…')
    await connection.query(schema)

    console.log('Applying users.is_active migration (004_capacity_users_active.sql)…')
    await connection.query(activeMigration)

    console.log('Applying Analyst access_level migration (005_capacity_users_analyst.sql)…')
    await connection.query(analystMigration)

    console.log('Applying clients table migration (006_capacity_clients.sql)…')
    await connection.query(clientsMigration)

    console.log('Applying planning documents migration (007_capacity_documents.sql)…')
    await connection.query(documentsMigration)

    console.log('Applying audit log and shared settings migration (008_capacity_audit_and_settings.sql)…')
    await connection.query(auditMigration)

    console.log('Dropping the unused AI assistant column (009_drop_ai_assistant_column.sql)…')
    await connection.query(dropAiMigration)

    console.log('Creating reporting views (010_capacity_reporting_views.sql)…')
    await connection.query(viewsMigration)

    console.log('Seeding demo users…')
    for (const demo of DEMO_USERS) {
      const passwordHash = await bcrypt.hash(demo.password, 12)
      const id = randomUUID()
      await connection.execute(
        `INSERT INTO users (id, email, password_hash, name, access_level, is_active)
         VALUES (?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           password_hash = VALUES(password_hash),
           name = VALUES(name),
           access_level = VALUES(access_level),
           is_active = 1`,
        [id, demo.email, passwordHash, demo.name, demo.accessLevel],
      )
      console.log(`  ✓ ${demo.email} (${demo.accessLevel})`)
    }

    console.log('Capacity database setup complete.')
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
