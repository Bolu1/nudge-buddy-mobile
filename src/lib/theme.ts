// JS-side copies of the theme tokens in global.css, for props that take a color
// value (icons, placeholderTextColor, ActivityIndicator, navigation chrome).
export const colors = {
  bg: "#151311",
  surfaceLowest: "#100e0c",
  surfaceLow: "#1d1b19",
  surface: "#211f1d",
  surfaceHigh: "#2c2927",
  surfaceHighest: "#373432",
  onSurface: "#e7e1de",
  onSurfaceVariant: "#c3c8bf",
  outline: "#8d928a",
  outlineVariant: "#434842",
  primary: "#b6cdb2",
  primaryContainer: "#8da38a",
  onPrimary: "#223522",
  onPrimaryContainer: "#263926",
  secondary: "#f7b8a5",
  secondaryContainer: "#673b2d",
  error: "#ffb4ab",
  errorContainer: "#93000a",
  gold: "#c3a06e",
  field: "#161412",
  fieldBorder: "#363330",
  divider: "#2c2927",
  placeholder: "#8a8680",
} as const;

export type Priority = "LOW" | "MEDIUM" | "HIGH";

export const priorityStyle: Record<Priority, { bg: string; text: string; border: string; label: string }> = {
  HIGH: { bg: "rgba(103,59,45,0.4)", text: "#f7b8a5", border: "#673b2d", label: "High" },
  MEDIUM: { bg: "rgba(38,57,38,0.4)", text: "#b6cdb2", border: "#263926", label: "Medium" },
  LOW: { bg: "#2c2927", text: "#8d928a", border: "#434842", label: "Low" },
};

