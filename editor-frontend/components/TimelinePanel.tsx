import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

type Clip = { id: string, start: number, end: number, label?: string }

export default function TimelinePanel(){
  const router = useRouter()
  const { jobId } = router.query as { jobId?: string }
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080'
  const [clips, setClips] = useState<Clip[]>([])

  useEffect(() => {
    if (!jobId) return
    let mounted = true
    const fetchAnalysis = async () => {
      try {
        const res = await fetch(`${apiBase}/outputs/${encodeURIComponent(String(jobId))}/analysis.json`)
        if (!res.ok) return
        const data = await res.json()
        // Try to extract candidate segments if present
        const parsed: Clip[] = (data?.candidates || data?.segments || []).map((c: any, i: number) => ({ id: String(i), start: c.start ?? c.s ?? 0, end: c.end ?? c.e ?? 0, label: c.label || c.type || `Seg ${i+1}` }))
        if (mounted) setClips(parsed)
      } catch (e) {
        // ignore
      }
    }
    fetchAnalysis()
    return () => { mounted = false }
  }, [jobId, apiBase])

  return (
    <div className="col-span-6 mt-2 rounded-2xl glass p-3">
      <div className="text-xs text-gray-400 mb-2">00:00 00:30 01:00 01:30 02:00 02:30 03:00</div>
      <div className="space-y-2">
        {clips.length === 0 ? (
          <div className="h-24 bg-white/4 rounded flex items-center px-3 text-sm text-gray-400">No timeline data — run analysis to populate clips.</div>
        ) : (
          clips.map(c => (
            <div key={c.id} className="h-12 bg-white/4 rounded flex items-center px-3 gap-3">
              <div className="w-24 h-6 rounded-full bg-purple-600 text-xs text-white flex items-center justify-center">{c.label}</div>
              <div className="w-full h-2 bg-white/6 rounded" />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
