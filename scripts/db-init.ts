/**
 * Creates the ArcPay tables in the Turso database named by TURSO_DATABASE_URL.
 * Safe to run repeatedly. Run `bun run setup` first if the variables are not set yet.
 */
import { connectDb, initSchema } from '../server/db'

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('TURSO_DATABASE_URL is not set. Run `bun run setup` and enter your Turso database URL and token.')
  process.exit(1)
}

try {
  const db = connectDb(url, process.env.TURSO_AUTH_TOKEN)
  await initSchema(db)
  console.log('Database ready: all ArcPay tables exist.')
  db.close()
} catch (error) {
  console.error('Could not initialise the database:', error instanceof Error ? error.message : String(error))
  process.exit(1)
}
