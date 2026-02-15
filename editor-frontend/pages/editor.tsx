import React, { useState } from 'react'
import TopToolbar from '../components/TopToolbar'
import StatusCard from '../components/StatusCard'

function Uploader(){
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState('idle')

  async function handleUpload(){
    if (!file) return setStatus('select a file')
    setStatus('requesting signed url')
    try {
      const contentType = file.type || 'application/octet-stream'
      const body = { filename: file.name, contentType }

      // Use explicit backend URL via NEXT_PUBLIC_API_URL (avoid proxy)
      const backendBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')
      console.log('[frontend] requesting signed URL', { filename: file.name, contentType })
      const resp = await fetch(`${backendBase}/api/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`Signed URL request failed: ${resp.status} ${txt}`)
      }
      const json = await resp.json()
      if (!json.uploadUrl && !json.signedUrl && !json.uploadUrl) throw new Error('No uploadUrl in response')

      const uploadUrl = json.uploadUrl || json.signedUrl
      console.log('[frontend] signed URL received')

      setStatus('uploading')
      console.log('[frontend] starting upload PUT to signed URL')
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
        credentials: 'omit'
      })

      if (!putRes.ok) {
        const text = await putRes.text()
        throw new Error('Upload failed: ' + putRes.status + ' ' + text)
      }

      console.log('[frontend] upload completed')
      setStatus('uploaded')
    } catch (e: any) {
      console.error('[frontend] upload error', e && (e.stack || e.message || e))
      setStatus('error: ' + (e && e.message ? e.message : String(e)))
    }
  }

  return (
    <div className="p-4 bg-white/5 rounded-md">
      <div className="mb-2">Upload test (uses /api/upload-url)</div>
      <input type="file" onChange={(e)=>setFile(e.target.files ? e.target.files[0] : null)} />
      <div className="mt-2 flex gap-2">
        <button onClick={handleUpload} className="px-3 py-1 bg-indigo-600 rounded text-white">Upload</button>
        <div className="text-sm text-gray-300">{status}</div>
      </div>
    </div>
  )
}

export default function EditorPage(){
  return (
    <>
      <TopToolbar />
      <div className="p-4 col-span-12 bg-gray-900 min-h-screen text-white">
        <Uploader />
      </div>
      <StatusCard />
    </>
  )
}
