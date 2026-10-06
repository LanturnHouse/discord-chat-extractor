// Types for the tests that import scripts/verify-dist.mjs (the script itself stays plain JavaScript so `node` runs it as is).
export function parseCsp(csp: string): Map<string, string[]>;
export function cspProblems(csp: unknown): string[];
export const REQUIRED_CSS_SELECTORS: readonly string[];
export function missingSelectors(css: string): string[];
export function importSpecifiers(code: string): { specifiers: string[]; hasDynamicNonLiteral: boolean };
export function verifyDist(options?: { distDir?: string; rootDir?: string }): { problems: string[]; notes: string[] };
