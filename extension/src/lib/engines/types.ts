// Normalized progress emitted by the on-device ML engines (OCR / transcribe /
// denoise / grammar / embed / kimtai) while downloading models and running.
export interface EngineProgress {
  phase: string; // 'download' | 'run'
  label: string;
  ratio: number | null;
  loaded?: number; // bytes, during the download phase
  total?: number;
}
export type OnProgress = (p: EngineProgress) => void;
