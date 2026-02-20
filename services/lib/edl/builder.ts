export function buildEDL(input: any): any {
  // Minimal EDL builder stub — real implementation required for full functionality
  return { hook: { start: 0, end: 0 }, segments: [], expectedChange: { finalDurationSec: 0, totalRemovedSec: 0 }, tracks: [], meta: {} }
}

export function validateEDL(edl: any): { valid: boolean; errors: string[] } {
  // Basic validation: accept any object with segments array
  const errors: string[] = []
  if (!edl || !Array.isArray(edl.segments)) errors.push('Invalid segments')
  return { valid: errors.length === 0, errors }
}
