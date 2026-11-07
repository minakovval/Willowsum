// Generated from openapi.json by scripts/generate.ts (ARC-07). Do not edit: run
// `pnpm contract:write` from the repository root.

export type paths = {
    "/v1/me/features": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The functions that are on for the current space */
        get: operations["getMyFeatures"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** My role and permissions in the current space */
        get: operations["getMyPermissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** API version */
        get: operations["getMeta"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        /** @description RFC 9457 problem details with a machine-readable code (ARC-07 FR 4). */
        Problem: {
            /**
             * @description Machine-readable code; new codes may be added
             * @enum {string}
             */
            code: "VALIDATION_FAILED" | "MALFORMED_REQUEST" | "INVALID_CURSOR" | "UNAUTHENTICATED" | "PLAN_LIMIT_REACHED" | "FORBIDDEN" | "NOT_FOUND" | "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_REQUEST_IN_PROGRESS" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "INTERNAL" | "MODULE_UNAVAILABLE";
            detail?: string;
            errors?: {
                /** @enum {string} */
                in: "path" | "query" | "header" | "body";
                issue: string;
                path: string;
            }[];
            status: number;
            /** @description Support code: the trace id the server drew for this request (32 hex digits); clients show it as the error code */
            supportId?: string;
            title: string;
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    getMyFeatures: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Keys of the functions that are on for the caller's space; functions that are off are not listed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        features: "household.core"[];
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getMyPermissions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's role, whether a scope restricts them, and the permissions they hold */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        permissions: ("household.data.read" | "household.data.write" | "assets.dispose" | "assets.trash" | "assets.groups.manage" | "locations.exact.read" | "members.manage" | "members.assign-privileged" | "scope.manage" | "billing.manage" | "household.transfer" | "export.full" | "export.reports" | "audit.read" | "bank.reconciliation.undo" | "support.access.approve" | "session.timeout.manage")[];
                        /** @enum {string} */
                        role: "owner" | "admin" | "editor" | "viewer" | "advisor";
                        scoped: boolean;
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not signed in (UNAUTHENTICATED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The plan of the space does not include this (PLAN_LIMIT_REACHED) */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The role or scope does not allow this (FORBIDDEN) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getMeta: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The API version */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        apiVersion: "v1";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Any other error, as problem details */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
}
