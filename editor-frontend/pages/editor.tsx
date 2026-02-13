import React, { useState } from 'react'
import EditorShell from '../components/EditorShell'
import TopToolbar from '../components/TopToolbar'
import StatusCard from '../components/StatusCard'

function Uploader(){
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState('idle')

  async function handleUpload(){
    if (!file) return setStatus('select a file')
    setStatus('requesting signed url')
    try {
      const body = { filename: file.name, contentType: file.type || 'application/octet-stream' }
      const backendBase = (process.env.NEXT_PUBLIC_BACKEND_URL) ? process.env.NEXT_PUBLIC_BACKEND_URL : 'http://localhost:8080'
      const resp = await fetch(`${backendBase}/api/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!resp.ok) throw new Error(await resp.text())
      const json = await resp.json()
      if (!json.signedUrl) throw new Error('No signedUrl in response')

      setStatus('uploading')
      // Use requiredHeaders from backend if provided to ensure signature matches
      const headers = Object.assign({}, json.requiredHeaders || {}, { 'Content-Type': body.contentType })
      const putResp = await fetch(json.signedUrl, { method: 'PUT', headers, body: file, credentials: 'omit' })
      if (!putResp.ok) {
        const text = await putResp.text()
        throw new Error(`Upload failed: ${putResp.status} ${text}`)
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
    <EditorShell>
      <TopToolbar />
      <div className="p-4 col-span-12">
        <Uploader />
      </div>
      <StatusCard />
    </EditorShell>
  )
}
