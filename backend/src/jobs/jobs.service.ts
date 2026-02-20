import prisma from '../db/prisma'

export async function createJob(data: { userId?: string; inputBucket: string; inputPath: string; outputBucket: string }) {
  const job = await prisma.job.create({
    data: {
      userId: data.userId,
      inputBucket: data.inputBucket,
      inputPath: data.inputPath,
      outputBucket: data.outputBucket
    }
  })
  return job
}

export async function getJob(id: string) {
  return prisma.job.findUnique({ where: { id } })
}

export async function markProcessing(id: string) {
  return prisma.job.update({ where: { id }, data: { status: 'PROCESSING' } })
}

export async function markDone(id: string, outputPath: string) {
  return prisma.job.update({ where: { id }, data: { status: 'DONE', outputPath, progress: 100 } })
}

export async function markError(id: string, error: string) {
  return prisma.job.update({ where: { id }, data: { status: 'ERROR', error } })
}

export async function findNextQueued() {
  // attempt to atomically claim a job: find first queued and update
  const job = await prisma.$transaction(async (tx) => {
    const j = await tx.job.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } })
    if (!j) return null
    const claimed = await tx.job.updateMany({ where: { id: j.id, status: 'QUEUED' }, data: { status: 'PROCESSING' } })
    if (claimed.count === 1) return tx.job.findUnique({ where: { id: j.id } })
    return null
  })
  return job
}
