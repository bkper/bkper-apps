/** Generated from /openapi.json. Do not edit directly. */
import "@bkper/bkper-api-types";
export interface paths {
    "/api/v1/parse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["parse"];
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
        File: bkper.File;
        Transaction: bkper.Transaction;
        ParseRequest: {
            bookId: string;
            file?: components["schemas"]["File"];
            transaction?: components["schemas"]["Transaction"];
        } | unknown | unknown;
        ParseResult: {
            transactions: {
                bookId: string;
                transaction: components["schemas"]["Transaction"];
            }[];
            fileProperties?: {
                [key: string]: string;
            };
            /** @enum {string} */
            outcome: "parsed" | "empty" | "error";
            error?: {
                code: string;
                message: string;
            };
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
    parse: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ParseRequest"];
            };
        };
        responses: {
            /** @description Unrecorded parsing results. Inspect outcome and error. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ParseResult"];
                };
            };
            /** @description Invalid parse request. */
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
