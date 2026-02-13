import React, { useMemo } from 'react'
import { useRouter } from 'next/router'

export default function CenterPreviewPanel(){
  const router = useRouter()
  const { jobId } = router.query as { jobId?: string }
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080'

  const src = useMemo(() => {
    if (!jobId) return undefined
    // prefer outputs final.mp4 path (may be served by backend/public)
    return `${apiBase}/outputs/${encodeURIComponent(String(jobId))}/final.mp4`
  }, [jobId, apiBase])

  return (
    <section className="col-span-6 p-4 flex flex-col gap-4">
      <div className="flex-1 rounded-2xl bg-black/60 glass p-3 flex items-center justify-center">
        {src ? (
          <video className="w-full h-full rounded-lg object-contain" controls src={src} />
        ) : (
          <div className="w-full h-full rounded-lg bg-gradient-to-br from-zinc-900 to-black border border-white/6 flex items-center justify-center text-gray-500">No video loaded</div>
        )}
      </div>

      <div className="rounded-2xl glass p-3">
        <div className="flex items-center justify-between text-sm text-gray-300 mb-2">
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-md bg-white/6">▶</button>
            <div>0:00 / 3:24</div>
          </div>
          <div className="text-xs text-gray-400">Zoom 100%</div>
        </div>
        <div className="h-10 bg-white/5 rounded-full" />
      </div>
    </section>
  )
}
