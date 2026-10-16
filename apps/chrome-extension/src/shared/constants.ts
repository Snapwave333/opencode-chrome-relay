export const NATIVE_HOST_NAME = "com.opencode.chrome_relay";
export const DEFAULT_BROKER_URL = "ws://127.0.0.1:4098";

export const OVERLAY_CONTAINER_ID = "opencode-relay-overlay-root";
export const DOCK_CONTAINER_ID = "opencode-relay-dock-root";

export const M3_COLORS = {
  primary: "#80d5e8",
  onPrimary: "#00363f",
  primaryContainer: "#004e5b",
  onPrimaryContainer: "#9eeffd",
  secondary: "#b1cbd1",
  onSecondary: "#1c3439",
  secondaryContainer: "#334a50",
  onSecondaryContainer: "#cde7ee",
  tertiary: "#ffb0ca",
  onTertiary: "#541d32",
  tertiaryContainer: "#6f3349",
  onTertiaryContainer: "#ffd9e3",
  surface: "#0f1416",
  surfaceContainerLowest: "#0b0f10",
  surfaceContainerLow: "#171d20",
  surfaceContainer: "#1b2225",
  surfaceContainerHigh: "#21292c",
  surfaceContainerHighest: "#2b3438",
  onSurface: "#deeaed",
  onSurfaceVariant: "#bfc8cb",
  outline: "#899396",
  outlineVariant: "rgba(137, 147, 150, 0.22)",
  error: "#ffb4ab",
  errorContainer: "#93000a",
  onError: "#690005",
  success: "#7cd992",
  successContainer: "#005322",
  onSuccess: "#003915",
} as const;

export const COLORS = {
  cyanPrimary: M3_COLORS.primary,
  magentaSteer: M3_COLORS.tertiary,
  bgDark: M3_COLORS.surface,
  surfaceDark: M3_COLORS.surfaceContainer,
  borderDark: M3_COLORS.outlineVariant,
  textDark: M3_COLORS.onSurface,
  textMuted: M3_COLORS.onSurfaceVariant,
  successGreen: M3_COLORS.success,
  errorRed: M3_COLORS.error,
};

