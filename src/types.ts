export interface AudioSegment {
  id: string;
  label: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  subtitle?: string; // Optional per-segment transcript
}

export interface ListeningMaterial {
  title: string;
  audioUrl: string;
  script: string;
  segments: AudioSegment[];
}
