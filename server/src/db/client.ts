import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema.js'
import { config } from 'dotenv'

config()

const client = createClient({
  url: process.env.DATABASE_URL ?? 'file:./joitec_crm.db',
})

export const db = drizzle(client, { schema })
