export interface Voice {
  id: string;
  label: string;
  description: string;
  premium: boolean;
}

export const VOICES: Voice[] = [
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George",  description: "Warm, deep British",          premium: false },
  { id: "4O1sYUnmtThcBoSBrri7", label: "Maya",    description: "Friendly and cheerful",        premium: true  },
  { id: "WAhoMTNdLdMoq1j3wf3I", label: "Hope",    description: "Smooth, engaging and kind",    premium: true  },
  { id: "DODLEQrClDo8wCz460ld", label: "Lauren",  description: "Friendly and comforting",      premium: true  },
  { id: "sB7vwSCyX0tQmU24cW2C", label: "Jon",     description: "Calm, natural authority",      premium: true  },
];

export const DEFAULT_VOICE_ID = VOICES.find((v) => !v.premium)!.id;

