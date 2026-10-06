/** Generated from /openapi.json. Do not edit directly. */
import "@bkper/bkper-api-types";
export interface paths {
    "/api/v1/discovery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["discover"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/discovery/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["discoverBatch"];
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
        DiscoveryItem: {
            itemId: string;
            bookId: string;
            transaction: components["schemas"]["Transaction"];
            sourceAccount?: components["schemas"]["Account"];
        };
        DiscoveryResult: {
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
        DiscoveryBatch: {
            items: components["schemas"]["DiscoveryItem"][];
        };
        DiscoveryBatchResult: {
            items: components["schemas"]["DiscoveryResult"][];
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
    discover: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DiscoveryItem"];
            };
        };
        responses: {
            /** @description Read-only discovery results. Inspect each item outcome and error. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscoveryResult"];
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
    discoverBatch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DiscoveryBatch"];
            };
        };
        responses: {
            /** @description Read-only discovery results. Inspect each item outcome and error. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscoveryBatchResult"];
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
