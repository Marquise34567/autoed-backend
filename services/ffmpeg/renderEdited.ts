import { run as runSpawn } from 'child_process'
import fs from 'fs'
import path from 'path'

function runProcess(cmd: string, args: string[], opts: any = {}) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    const cp = require('child_process').spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let stdout = ''
    let stderr = ''
    cp.stdout.on('data', (d: any) => { stdout += d.toString() })
    cp.stderr.on('data', (d: any) => { stderr += d.toString() })
    cp.on('error', (err: any) => reject(err))
    cp.on('close', (code: number) => resolve({ stdout, stderr, code: code ?? 0 }))
  })
}

/**
 * Render edited video by concatenating: HOOK (moved to start) + remaining timeline excluding cuts and original hook
 * hook: { start, end }
 * cuts: array of { start, end }
 */
export async function renderEditedVideo(normalizedLocal: string, hook: { start: number; end: number }, cuts: Array<{ start: number; end: number }>, outLocal: string) {
  // build include intervals: everything except cuts and original hook
  const durationRes = await runProcess('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', normalizedLocal])
  const duration = Number((durationRes.stdout || '').trim()) || 0

  // merge cuts and hook into a removal list
  const removals = (cuts || []).slice().map(c => ({ start: c.start, end: c.end }))
  // also remove original hook
  if (hook && typeof hook.start === 'number') removals.push({ start: hook.start, end: hook.end })
  // sort removals
  removals.sort((a,b)=>a.start-b.start)

  // build keep intervals by inverting removals
  const keeps: Array<{ start:number; end:number }> = []
  let cursor = 0
  for (const r of removals) {
    if (r.start > cursor) keeps.push({ start: cursor, end: Math.max(cursor, r.start) })
    cursor = Math.max(cursor, r.end)
  }
  if (cursor < duration) keeps.push({ start: cursor, end: duration })

  // prepare temp dir and segment files
  const tmpDir = path.resolve(process.cwd(), 'tmp', 'renders', `segments-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  const segmentFiles: string[] = []

  // first segment is the hook (moved to front)
  const hookFile = path.join(tmpDir, 'seg-hook.mp4')
  await runProcess('ffmpeg', ['-y','-hide_banner','-nostats','-ss', String(hook.start), '-to', String(hook.end), '-i', normalizedLocal, '-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac','-b:a','192k', hookFile])
  segmentFiles.push(hookFile)

  // then each keep interval in order
  let idx = 0
  for (const k of keeps) {
    // skip empty intervals
    if (k.end - k.start < 0.05) continue
    const fname = path.join(tmpDir, `seg-${idx}.mp4`)
    await runProcess('ffmpeg', ['-y','-hide_banner','-nostats','-ss', String(k.start), '-to', String(k.end), '-i', normalizedLocal, '-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac','-b:a','192k', fname])
    segmentFiles.push(fname)
    idx += 1
  }

  // create concat list
  const listFile = path.join(tmpDir, 'list.txt')
  fs.writeFileSync(listFile, segmentFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))

  // run concat demuxer
  await runProcess('ffmpeg', ['-y','-hide_banner','-nostats','-f','concat','-safe','0','-i', listFile, '-c','copy', outLocal])

  return outLocal
}

export default { renderEditedVideo }
