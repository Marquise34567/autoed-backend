export type EDLSegment = {
  start: number;
  end: number;
  score?: number;
  reason?: string;
};

export type EDL = {
  hook: { start: number; end: number; reason?: string };
  segments: EDLSegment[];
  expectedChange?: { originalDurationSec?: number; finalDurationSec?: number; totalRemovedSec?: number };
};
