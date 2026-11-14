/** Generated from /openapi.json. Do not edit directly. */
import "@bkper/bkper-api-types";
export interface paths {
    "/api/v1/extract": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["extract"];
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
        ExtractRequest: {
            bookId: string;
            file?: components["schemas"]["File"];
            transaction?: components["schemas"]["Transaction"];
        } | unknown | unknown;
        ExtractResult: {
            transactions: {
                bookId: string;
                transaction: components["schemas"]["Transaction"];
            }[];
            fileProperties?: {
                [key: string]: string;
            };
            /**
             * @description Set for File requests without a Transaction: transaction when the File was read as one invoice or receipt, transactions when it was read as statement rows.
             * @enum {string}
             */
            kind?: "transaction" | "transactions";
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
    extract: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExtractRequest"];
            };
        };
        responses: {
            /** @description Unrecorded extraction results. Inspect outcome and error. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExtractResult"];
                };
            };
            /** @description Invalid extract request. */
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
