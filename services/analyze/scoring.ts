export function scoreCandidates(candidates: Array<any>, transcript: any, silenceIntervals: any): Array<any> {
  // Minimal scoring stub: pass through candidates and attach default score if missing
  return (candidates || []).map((c) => ({ ...(c || {}), score: typeof c?.score === 'number' ? c.score : 0 }));
}
