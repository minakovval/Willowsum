// Generated from openapi.json by scripts/generate.ts (ARC-07). Do not edit: run
// `pnpm contract:write` from the repository root.

export type paths = {
    "/v1/email-confirmations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm the email address with the token of a confirmation link */
        post: operations["confirmEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/email-confirmations/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A new confirmation link instead of an expired one («Надіслати ще раз» on «Посилання недійсне») */
        post: operations["resendConfirmationEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
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
    "/v1/password-resets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ask for a password reset link by email («Відновлення пароля») */
        post: operations["requestPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/password-resets/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Whether a password reset link can still be used (before the new-password form is shown) */
        post: operations["checkPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/password-resets/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a new password with a password reset link */
        post: operations["completePasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/registrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign up with name, email and password */
        post: operations["signUp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/registrations/change-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Leave the «check your email» screen to sign up with another address («Змінити email») */
        post: operations["changeRegistrationEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/registrations/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send the letter of a sign-up again («Надіслати ще раз») */
        post: operations["resendRegistrationEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The signed-in account of this browser */
        get: operations["getSession"];
        put?: never;
        post?: never;
        /** Sign out of this browser */
        delete: operations["signOut"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/session/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A user action in this browser: extend the session and rotate its token */
        post: operations["refreshSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign in with email and password */
        post: operations["signIn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/space": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The current space: its name (shown in the profile), data region and reporting currency */
        get: operations["getSpace"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Rename the current space (Owner) */
        patch: operations["renameSpace"];
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        /** @description RFC 9457 problem details with a machine-readable code (ARC-07 FR 4). */
        Problem: {
            /** @description VERSION_CONFLICT: the fields changed since the client's version — the readable fields of the base values it sent whose stored value now differs (field names only; fields left out of the base are not reported) */
            changedFields?: string[];
            /**
             * @description Machine-readable code; new codes may be added
             * @enum {string}
             */
            code: "VALIDATION_FAILED" | "MALFORMED_REQUEST" | "INVALID_CURSOR" | "UNAUTHENTICATED" | "SESSION_ENDED" | "INVALID_CREDENTIALS" | "CAPTCHA_REQUIRED" | "PLAN_LIMIT_REACHED" | "FORBIDDEN" | "ORIGIN_NOT_ALLOWED" | "NOT_FOUND" | "RESET_LINK_INVALID" | "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_REQUEST_IN_PROGRESS" | "VERSION_CONFLICT" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "LIMIT_REACHED" | "RATE_LIMITED" | "SIGN_IN_LOCKED" | "INTERNAL" | "MODULE_UNAVAILABLE" | "SERVICE_UNAVAILABLE";
            /** @description VERSION_CONFLICT: the current version of the record */
            currentVersion?: number;
            detail?: string;
            errors?: {
                /** @enum {string} */
                in: "path" | "query" | "header" | "body";
                issue: string;
                path: string;
            }[];
            /** @description LIMIT_REACHED: the limit that was reached */
            limit?: number;
            /**
             * @description SESSION_ENDED: idle (15 min without a user action), expired (12 h after sign-in), signed-out (this browser signed out), ended-elsewhere (a password reset or a reused token ended it)
             * @enum {string}
             */
            sessionEndReason?: "idle" | "expired" | "signed-out" | "ended-elsewhere";
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
    confirmEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description confirmed; expired (screen «Посилання недійсне» with «Надіслати ще раз»); already-used (sign-in page); invalid. Never a session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        result: "confirmed" | "expired" | "already-used" | "invalid";
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
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    resendConfirmationEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description A new link is on its way and the old ones no longer work; 429 with Retry-After as for any resend */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        resendAfterS: number;
                        /** @constant */
                        status: "sent";
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
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
                        features: ("household.core" | "household.space-settings" | "identity.sign-in")[];
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
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
                        permissions: ("household.data.read" | "household.data.write" | "assets.dispose" | "assets.trash" | "assets.groups.manage" | "locations.exact.read" | "members.manage" | "members.assign-privileged" | "scope.manage" | "billing.manage" | "household.transfer" | "household.rename" | "export.full" | "export.reports" | "audit.read" | "bank.reconciliation.undo" | "support.access.approve" | "session.timeout.manage")[];
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
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    requestPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                };
            };
        };
        responses: {
            /** @description Always «if the account exists, we sent a letter» (ACC-01 FR 10, NFR-15 FR 1): the same answer and time for an address with and without an account. An account gets a link valid 60 min that revokes its earlier links, at most one letter per 60 s and 5 per hour */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "requested";
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
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    checkPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description valid: the form for the new password may be shown. 410 RESET_LINK_INVALID: «Посилання недійсне» (used, replaced, older than 60 min or unknown). Changes nothing */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "valid";
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
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description This password reset link is no longer valid (RESET_LINK_INVALID) */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    completePasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    password: string;
                    token: string;
                };
            };
        };
        responses: {
            /** @description The password is changed, every session of the account has ended (this browser's cookie is removed too; no new session), the address counts as confirmed and a security notice is on its way. 410 RESET_LINK_INVALID when the link can no longer be used */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "password-changed";
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
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description This password reset link is no longer valid (RESET_LINK_INVALID) */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    signUp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    captchaToken?: string;
                    email: string;
                    name: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description Always «check your email», whether the address already has an account or not (ACC-01 FR 8); no session is created */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        registrationToken: string;
                        resendAfterS: number;
                        /** @constant */
                        status: "check-email";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR); Complete the CAPTCHA and try again (CAPTCHA_REQUIRED) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    changeRegistrationEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    registrationToken: string;
                };
            };
        };
        responses: {
            /** @description This sign-up's token and its confirmation link no longer work; an existing account is never changed. The client returns to the filled-in sign-up form */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "closed";
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
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    resendRegistrationEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    registrationToken: string;
                };
            };
        };
        responses: {
            /** @description The letter is on its way; the same for a new and a taken address. 429 with Retry-After within 60 s of the last letter or after 5 in an hour */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        resendAfterS: number;
                        /** @constant */
                        status: "sent";
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
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The account of the session. Reading does not extend the session (only POST /v1/session/refresh does). 401 SESSION_ENDED with sessionEndReason when this browser's session has ended (its cookie is removed); 401 UNAUTHENTICATED without a session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        email: string;
                        name: string;
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
            /** @description Sign-in is required (UNAUTHENTICATED); The session has ended; sign in again (SESSION_ENDED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    signOut: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The session has ended and its cookie is removed (also when there was none) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "signed-out";
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
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    refreshSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The client sends it for user actions only (click, input, navigation; ACC-04 business rules), never for background requests. The 15 min idle deadline moves for every tab of the browser and the session cookie gets a new token (NFR-01 FR 12); the 12 h end never moves. A token replaced less than 30 s ago (another tab's request on its way) extends the session without a new token; one replaced earlier ends the session (401 SESSION_ENDED, ended-elsewhere) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInS: number;
                        idleTimeoutS: number;
                        /** @constant */
                        status: "active";
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
            /** @description Sign-in is required (UNAUTHENTICATED); The session has ended; sign in again (SESSION_ENDED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    signIn: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    captchaToken?: string;
                    email: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description signed-in: the session cookie is set. email-not-confirmed: no session; «Надіслати лист ще раз» uses registrationToken */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        registrationToken?: string;
                        resendAfterS?: number;
                        /** @enum {string} */
                        status: "signed-in" | "email-not-confirmed";
                    };
                };
            };
            /** @description The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR); Complete the CAPTCHA and try again (CAPTCHA_REQUIRED) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Wrong email or password (INVALID_CREDENTIALS) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found (NOT_FOUND): the function is off */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 60 per minute for this route); Sign-in is temporarily locked; try again later (SIGN_IN_LOCKED) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    getSpace: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's space */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        dataRegion: "eu";
                        name: string;
                        /** @enum {string} */
                        reportingCurrency: "EUR";
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
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
    renameSpace: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description The space with its new name */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        dataRegion: "eu";
                        name: string;
                        /** @enum {string} */
                        reportingCurrency: "EUR";
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
            /** @description The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED) */
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
            /** @description Too many requests from this client in the current minute (RATE_LIMITED; 600 per minute for this route) */
            429: {
                headers: {
                    /** @description Seconds until the current one-minute window ends */
                    "Retry-After"?: number;
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
}
