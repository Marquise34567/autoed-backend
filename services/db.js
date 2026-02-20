const { PrismaClient } = require('@prisma/client')
let prisma = null

function getPrisma() {
  if (!prisma) prisma = new PrismaClient()
  return prisma
}

async function testConnection() {
  const p = getPrisma()
  try {
    await p.$queryRaw`SELECT 1`
    return true
  } catch (e) {
    console.error('[services/db] testConnection failed', e && (e.message || e))
    return false
  }
}

module.exports = { getPrisma, testConnection }
