export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type ManualFacecamCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  // legacy aliases
  w?: number;
  h?: number;
};
