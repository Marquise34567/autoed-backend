import { spawn } from 'child_process'

function runProcess(cmd: string, args: string[], opts: any = {}) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    const cp = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let stdout = ''
    let stderr = ''
    cp.stdout.on('data', (d) => { stdout += d.toString() })
    cp.stderr.on('data', (d) => { stderr += d.toString() })
    cp.on('error', (err) => reject(err))
    cp.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
  })
}

export async function probeDurationSec(inputPath: string): Promise<number> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath]
  const res = await runProcess('ffprobe', args)
  if (res.code !== 0) {
    throw new Error(`ffprobe failed: ${res.stderr.slice(-200)}`)
  }
  try {
    const j = JSON.parse(res.stdout)
    const d = Number(j?.format?.duration || 0)
    if (!isFinite(d) || d <= 0) throw new Error('Invalid duration from ffprobe')
    return d
  } catch (e: any) {
    throw new Error(`ffprobe parse error: ${e?.message || String(e)} ${res.stderr.slice(-200)}`)
  }
}

export async function detectSilenceSegments(inputPath: string): Promise<Array<{ start: number; end: number }>> {
  // Use ffmpeg silencedetect; parse stderr lines
  const args = ['-hide_banner', '-nostats', '-i', inputPath, '-af', 'silencedetect=noise=-35dB:d=0.6', '-f', 'null', '-']
  const res = await runProcess('ffmpeg', args)
  const out = res.stderr || ''
  const starts: number[] = []
  const segments: Array<{ start: number; end: number }> = []
  const reStart = /silence_start:\s*([0-9]+(?:\.[0-9]+)?)/
  const reEnd = /silence_end:\s*([0-9]+(?:\.[0-9]+)?)/
  out.split(/\r?\n/).forEach((ln) => {
    const m1 = ln.match(reStart)
    if (m1) {
      starts.push(Number(m1[1]))
    }
    const m2 = ln.match(reEnd)
    if (m2) {
      const end = Number(m2[1])
      const start = starts.length ? starts.shift()! : Math.max(0, end - 5)
      if (end > start) segments.push({ start, end })
    }
  })
  return segments
}

export function selectBoringCuts(durationSec: number, silenceSegments: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (!Array.isArray(silenceSegments)) return []
  // prefer longer silences first
  const segs = silenceSegments.slice().map(s => ({ start: s.start, end: s.end, len: s.end - s.start })).filter(s => s.len > 0).sort((a,b) => b.len - a.len)
  const cuts: Array<{ start: number; end: number }> = []
  const cap = Math.max( Math.min(durationSec * 0.2, durationSec * 0.25), durationSec * 0.1 ) // cap between 10-25% (pref ~20%)
  let removed = 0
  for (const s of segs) {
    if (removed >= cap) break
    // consider only silences that can host at least 5s
    if (s.len < 5) continue
    const want = Math.min(10, s.len, cap - removed)
    if (want < 5) continue
    const start = Math.max(0, s.start + Math.max(0, (s.len - want) / 2))
    const end = Math.min(durationSec, start + want)
    cuts.push({ start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) })
    removed += (end - start)
  }
  return cuts
}

export default {
  probeDurationSec,
  detectSilenceSegments,
  selectBoringCuts,
}

export async function analyzeVideo(inputPath: string) {
  // high-level analysis: duration, silence, per-second energy, basic hook candidates
  const duration = await probeDurationSec(inputPath)
  const silence = await detectSilenceSegments(inputPath)

  // compute per-second RMS energy using ffmpeg astats over 1s windows
  const args = ['-hide_banner', '-nostats', '-i', inputPath, '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level', '-f', 'null', '-']
  let energyOut = ''
  try {
    const res = await runProcess('ffmpeg', args)
    energyOut = res.stderr || res.stdout || ''
  } catch (e) {
    energyOut = ''
  }

  // Parse numeric energy lines (best-effort)
  const energies: Array<number> = []
  energyOut.split(/\r?\n/).forEach((ln) => {
    const m = ln.match(/RMS_level=([-0-9.]+)/)
    if (m) energies.push(Number(m[1]))
  })

  // convert RMS dB values to linear-ish positive numbers for scoring
  const energyLinear = energies.map(e => isFinite(e) ? Math.pow(10, e / 20) : 0)

  // generate candidate windows (3,5,7,10s) sliding by 1s
  const windows = [3,5,7,10]
  const candidates: Array<any> = []
  for (let w of windows) {
    for (let t = 0; t + w <= Math.max(1, Math.floor(duration)); t++) {
      // energy score: average energyLinear over window (approx)
      const startIdx = Math.max(0, Math.floor(t))
      const endIdx = Math.min(energyLinear.length, Math.floor(t + w))
      const slice = energyLinear.slice(startIdx, endIdx)
      const energyAvg = slice.length ? slice.reduce((s,a)=>s+a,0)/slice.length : 0
      // silence coverage in window
      const silenceCoverage = silence.reduce((acc, s) => {
        const overlap = Math.max(0, Math.min(s.end, t + w) - Math.max(s.start, t))
        return acc + overlap
      }, 0) / w

      // simple heuristics for curiosity keyword detection: not available without transcript
      const curiosityKeywords = 0
      const wordsPerSecond = slice.length ? Math.max(0.1, slice.filter(v=>v>0.0005).length / Math.max(1, slice.length)) : 0

      // score per strategist formula weights (approximate)
      const score = (energyAvg * 0.30) + (wordsPerSecond * 0.25) + (curiosityKeywords * 0.25) + (1 * 0.20) - (silenceCoverage * 0.50)

      candidates.push({ start: Number(t.toFixed(3)), end: Number((t + w).toFixed(3)), duration: w, energyAvg, wordsPerSecond, curiosityKeywords, silenceCoverage, score })
    }
  }

  candidates.sort((a,b) => b.score - a.score)
  return { duration, silenceSegments: silence, hookCandidates: candidates.slice(0, 50) }
}
