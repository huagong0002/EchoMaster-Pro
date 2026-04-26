export interface AudioSegment {
  id: string;
  label: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  subtitle?: string; // Optional per-segment transcript
}

export interface ListeningMaterial {
  id?: string;
  authorId?: string;
  authorName?: string;
  title: string;
  audioUrl: string;
  script: string;
  segments: AudioSegment[];
  createdAt?: string;
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
}
