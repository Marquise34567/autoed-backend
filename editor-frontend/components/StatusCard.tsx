import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

type JobStatus = {
  status?: string
  step?: string
  progress?: number
  etaSec?: number
  message?: string
}

export default function StatusCard(){
  const router = useRouter()
  const { jobId } = router.query as { jobId?: string }
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || 'https://remarkable-comfort-production-4a9a.up.railway.app'
  if (!process.env.NEXT_PUBLIC_API_BASE_URL) console.warn('NEXT_PUBLIC_API_BASE_URL not set; defaulting to', apiBase)
  const [job, setJob] = useState<JobStatus | null>(null)

  useEffect(() => {
    if (!jobId) return
    let mounted = true
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${apiBase}/api/job-status?id=${encodeURIComponent(String(jobId))}`)
        const data = await res.json()
        if (mounted) setJob({ status: data.status || data.phase || 'unknown', step: data.step || data.stage || data.stage || data.stage, progress: data.progress ?? data.percent ?? data.progress, etaSec: data.etaSec, message: data.message })
      } catch (e) {
        // ignore
      }
    }

    fetchStatus()
    const id = setInterval(fetchStatus, 2500)
    return () => { mounted = false; clearInterval(id) }
  }, [jobId, apiBase])

  if (!jobId) return null

  const progressPct = Math.max(0, Math.min(100, Math.round((job?.progress ?? 0) * 100)))

  return (
    <div className="absolute right-8 top-8 w-64 glass p-3 rounded-xl shadow-lg">
      <div className="flex items-center justify-between text-xs text-gray-300">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${job?.status === 'error' ? 'bg-red-500' : job?.status === 'done' ? 'bg-emerald-400' : 'bg-yellow-400'}`} />
          <span className="capitalize">{job?.status || 'unknown'}</span>
        </div>
        <div className="text-gray-400">{job?.etaSec ? `ETA ${Math.round(job.etaSec / 60)}m` : ''}</div>
      </div>
      <div className="mt-3 h-2 bg-white/6 rounded overflow-hidden">
        <div className="h-full bg-purple-500 transition-all" style={{width:`${progressPct}%`}} />
      </div>
      <div className="mt-2 text-xs text-gray-400">Step: {job?.step || job?.message || '—'}</div>
    </div>
  )
}
