/**
 * Returns the app version baked from `build-meta.json` (`Ver 1.001`, `Ver 1.002`, ...),
 * which is incremented on every app addition/modification request with 0 Firestore reads.
 */
export function getInitialDisplayVersion(): string {
  return __APP_VERSION__;
}

/**
 * Resolves the current app version baked from `build-meta.json`.
 */
export async function syncDeployedVersion(): Promise<string> {
  return __APP_VERSION__;
}
