// Types of kms-key.mjs.
export declare function defaultKmsKeyFile(home?: string): string;
export declare function backupBesideKey(file: string, keyFile?: string): boolean;
export declare function keyReminder(keyFile?: string): string;
