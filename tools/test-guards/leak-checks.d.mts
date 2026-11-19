// Types of leak-checks.mjs.
export declare const RAW_OK_MARKER: string;
export declare function findRawBodyLeakChecks(source: string): { line: number; text: string }[];
