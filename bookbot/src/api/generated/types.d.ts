/** Generated from /openapi.json. Do not edit directly. */
import "@bkper/bkper-api-types";
export interface paths {
    "/api/v1/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/complete/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["completeBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Account: bkper.Account;
        Transaction: bkper.Transaction;
        CompletionItem: {
            itemId: string;
            bookId: string;
            transaction: components["schemas"]["Transaction"];
            sourceAccount?: components["schemas"]["Account"];
        };
        CompletionResult: {
            itemId: string;
            bookId: string;
            transaction: components["schemas"]["Transaction"];
            /** @enum {string} */
            outcome: "changed" | "no_change" | "no_match" | "error";
            error?: {
                code: string;
                message: string;
            };
        };
        CompletionBatch: {
            items: components["schemas"]["CompletionItem"][];
        };
        CompletionBatchResult: {
            items: components["schemas"]["CompletionResult"][];
        };
        ErrorResponse: {
            error: {
                code: string;
                message: string;
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    complete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompletionItem"];
            };
        };
        responses: {
            /** @description Read-only completion results. Inspect each item outcome and error. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompletionResult"];
                };
            };
            /** @description Invalid request or duplicate item identifiers. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Platform authentication required. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    completeBatch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompletionBatch"];
            };
        };
        responses: {
            /** @description Read-only completion results. Inspect each item outcome and error. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompletionBatchResult"];
                };
            };
            /** @description Invalid request or duplicate item identifiers. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Platform authentication required. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
