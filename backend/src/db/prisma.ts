import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default prisma

export async function testConnection(): Promise<boolean> {
  try {
    // simple query
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch (e) {
    console.error('[db] testConnection failed', e)
    return false
  }
}
