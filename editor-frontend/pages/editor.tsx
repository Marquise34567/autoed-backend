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
      const body = { filename: file.name }
      // Prefer explicit API base env var; default to local dev or Railway production
      const backendBase = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080'
      if (!process.env.NEXT_PUBLIC_API_BASE_URL) {
        console.warn('NEXT_PUBLIC_API_BASE_URL not set; defaulting to', backendBase)
      }
      const resp = await fetch(`${backendBase}/api/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!resp.ok) throw new Error(await resp.text())
      const json = await resp.json()
      if (!json.uploadUrl) throw new Error('No uploadUrl in response')

      setStatus('uploading')
      // Log the signed URL and its query params for debugging
      try {
        console.log('Upload URL (from server):', json.uploadUrl)
        const u = new URL(json.uploadUrl)
        console.log('Signed URL params:', { 'X-Goog-SignedHeaders': u.searchParams.get('X-Goog-SignedHeaders'), 'X-Goog-Signature': u.searchParams.get('X-Goog-Signature') ? 'present' : 'missing' })
      } catch (e) {
        console.warn('Could not parse uploadUrl for debug logging')
      }

      const uploadUrl = json.uploadUrl

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        body: file
      });

      if (!uploadResponse.ok) {
        throw new Error("Upload failed with status " + uploadResponse.status);
      }
      setStatus('uploaded')
    } catch (e: any) {
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
