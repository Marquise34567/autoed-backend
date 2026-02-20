import { PrismaClient } from '@prisma/client'

let prisma: PrismaClient | null = null

export function getPrisma(): PrismaClient {
  if (!prisma) prisma = new PrismaClient()
  return prisma
}

export async function testConnection(): Promise<boolean> {
  const p = getPrisma()
  try {
    // Simple query to verify connectivity
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await p.$queryRaw`SELECT 1`
    return true
  } catch (e: any) {
    console.error('[services/db] testConnection failed', e && (e.message || e))
    return false
  }
}

export default { getPrisma, testConnection }
