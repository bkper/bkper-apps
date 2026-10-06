# Bank Statement Transactions Extractor API Specification

## Overview

This document specifies the API interface for a Bkper partner service that will extract transactions from bank statements, compatible with Bookbot. The service should process various file formats (CSV, PDF, images) and return structured transaction data.

## Base API Endpoint

**Base URL**: `https://your-service.com/api/v1`

## API Endpoints

### 1. Process Bank Statement File

**HTTP Methods**: `POST`

**Content-Type**: `application/json`

#### Request Body (JSON)

```json
{
    "book": {
        "id": "string",
        "name": "string",
        "ownerName": "string",
        "datePattern": "string",
        "decimalSeparator": "DOT | COMMA",
        "fractionDigits": "number",
        "timeZone": "string",
        "timeZoneOffset": "number",
        "period": "MONTH | QUARTER | YEAR",
        "periodStartMonth": "JANUARY | FEBRUARY | MARCH | APRIL | MAY | JUNE | JULY | AUGUST | SEPTEMBER | OCTOBER | NOVEMBER | DECEMBER",
        "autoPost": "boolean",
        "lockDate": "string",
        "closingDate": "string",
        "visibility": "PUBLIC | PRIVATE",
        "permission": "OWNER | EDITOR | POSTER | RECORDER | VIEWER | NONE",
        "collection": {
            "id": "string",
            "name": "string",
            "ownerUsername": "string",
            "permission": "OWNER | EDITOR | POSTER | RECORDER | VIEWER | NONE",
            "agentId": "string",
            "createdAt": "string",
            "updatedAt": "string",
            "books": []
        },
        "accounts": [],
        "groups": [],
        "properties": {
            ["string": "string"]
        },
        "createdAt": "string",
        "updatedAt": "string",
        "lastUpdateMs": "string",
        "agentId": "string",
        "pageSize": "number",
        "totalTransactions": "number",
        "totalTransactionsCurrentMonth": "number",
        "totalTransactionsCurrentYear": "number"
    },
    "account": {
        "id": "string",
        "name": "string",
        "properties": {
            ["string": "string"]
        }
    },
    "group": {
        "id": "string",
        "name": "string",
        "normalizedName": "string",
        "properties": {
            ["string": "string"]
        }
    },
    "file": {
        "id": "string",
        "name": "string",
        "content": "string (base64 encoded)",
        "contentType": "string"
    }
}
```

#### Fields description

| Field                                    | Type    | Required | Description                                                                                        |
| ---------------------------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------- |
| `book.id`                                | String  | Yes      | Unique identifier of the Bkper book                                                                |
| `book.name`                              | String  | Yes      | Display name of the Bkper book                                                                     |
| `book.ownerName`                         | String  | No       | Username of the book owner                                                                         |
| `book.datePattern`                       | String  | Yes      | Date format pattern used by the book (e.g. `dd/MM/yyyy`)                                           |
| `book.decimalSeparator`                  | Enum    | Yes      | Decimal separator used in amounts: `DOT` or `COMMA`                                                |
| `book.fractionDigits`                    | Number  | No       | Number of decimal places (e.g. `2` for `####.##`)                                                  |
| `book.timeZone`                          | String  | No       | IANA time zone identifier (e.g. `America/New_York`)                                                |
| `book.timeZoneOffset`                    | Number  | No       | Time zone offset from UTC, in minutes                                                              |
| `book.period`                            | Enum    | No       | Period slice for balance visualization: `MONTH`, `QUARTER`, or `YEAR`                              |
| `book.periodStartMonth`                  | Enum    | No       | Starting month when period is `YEAR` (e.g. `JANUARY`)                                             |
| `book.autoPost`                          | Boolean | No       | Whether the book has auto-post enabled                                                             |
| `book.lockDate`                          | String  | No       | ISO date (`yyyy-MM-dd`) on or before which transactions are locked                                 |
| `book.closingDate`                       | String  | No       | ISO date (`yyyy-MM-dd`) on or before which transactions are closed for the period                  |
| `book.visibility`                        | Enum    | No       | Book visibility: `PUBLIC` or `PRIVATE`                                                             |
| `book.permission`                        | Enum    | No       | Current user's permission level: `OWNER`, `EDITOR`, `POSTER`, `RECORDER`, `VIEWER`, or `NONE`     |
| `book.collection`                        | Object  | No       | The collection this book belongs to, if any                                                        |
| `book.collection.id`                     | String  | No       | Unique identifier of the collection                                                                |
| `book.collection.name`                   | String  | No       | Display name of the collection                                                                     |
| `book.collection.ownerUsername`          | String  | No       | Username of the collection owner                                                                   |
| `book.collection.permission`             | Enum    | No       | Current user's permission on the collection: `OWNER`, `EDITOR`, `POSTER`, `RECORDER`, `VIEWER`, or `NONE` |
| `book.collection.agentId`                | String  | No       | Identifier of the agent that created the collection                                                |
| `book.collection.createdAt`              | String  | No       | Collection creation timestamp in milliseconds                                                      |
| `book.collection.updatedAt`              | String  | No       | Collection last update timestamp in milliseconds                                                   |
| `book.collection.books`                  | Array   | No       | All books belonging to the collection. Each entry has the same fields as `book` (without `collection`). A book may or may not have a collection. If it does have a collection, the collection will at least include the book itself. |
| `book.accounts`                          | Array   | No       | List of accounts scoped by where the configured parser URL is located: account, group, or book. When the URL is on a group, this is the non-archived accounts in that group. |
| `book.groups`                            | Array   | No       | List of account groups in the book                                                                 |
| `book.properties`                        | Object  | No       | Custom key-value metadata pairs attached to the book                                               |
| `book.createdAt`                         | String  | No       | Creation timestamp in milliseconds                                                                 |
| `book.updatedAt`                         | String  | No       | Last update timestamp in milliseconds                                                              |
| `book.lastUpdateMs`                      | String  | No       | Last update date in milliseconds (legacy field)                                                    |
| `book.agentId`                           | String  | No       | Identifier of the agent that created the book                                                      |
| `book.pageSize`                          | Number  | No       | Pagination page size for transaction queries                                                       |
| `book.totalTransactions`                 | Number  | No       | Total number of transactions posted in the book                                                    |
| `book.totalTransactionsCurrentMonth`     | Number  | No       | Total transactions posted in the current month                                                     |
| `book.totalTransactionsCurrentYear`      | Number  | No       | Total transactions posted in the current year                                                      |
| `account.id`                             | String  | Yes      | Bkper account identifier                                                                           |
| `account.name`                           | String  | Yes      | Bkper account name                                                                                 |
| `account.properties`                     | Object  | No       | Optional key-value pairs for account metadata                                                      |
| `group`                                  | Object  | No       | Matched group context when the configured parser URL was found on a group property. Omitted for account- and book-level parser URLs. The object uses Bkper's canonical group shape and may include additional fields beyond the ones listed below. |
| `group.id`                               | String  | Yes, when `group` is present | Bkper group identifier                                                               |
| `group.name`                             | String  | Yes, when `group` is present | Bkper group name                                                                     |
| `group.normalizedName`                   | String  | No       | Normalized group name                                                                               |
| `group.properties`                       | Object  | No       | Optional key-value pairs for group metadata. Internal `agent_` parser configuration properties are omitted from this top-level group context. |
| `file.id`                                | String  | Yes      | Bkper file identifier                                                                              |
| `file.name`                              | String  | Yes      | Original filename with extension                                                                   |
| `file.content`                           | String  | Yes      | Base64 encoded file content                                                                        |
| `file.contentType`                       | String  | Yes      | MIME type (`text/csv`, `application/pdf`, `image/jpeg`, `image/png`)                               |

#### Common Property Keys and values

**Book Properties:**
- `exc_code`: Exchange/currency code (values: "USD", "EUR")
- `exc_base`: Whether this is the base currency (values: "true" or "false")
- `stock_book`: Related stock book identifier (values: "true" or "false")
- `report_order`: Ordering for report generation (values: "10", "33")

**Account Properties:**
- `type`: Account type (values: "ASSET", "LIABILITY", "INCOME", "EXPENSE")
- `group`: Account grouping/category (values: "Cash", "Investments")
- `report_order`: Ordering for report generation (values: "7", "8")

*Note: Properties are optional and can contain any custom key-value pairs relevant to your Bkper configuration.*

#### Request Example

```bash
curl -X POST https://your-service.com/api/v1/extract-transactions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
        "book": {
          "id": "agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICA4PT116AJDA",
          "name": "TP Prueba Import Bot USD",
          "ownerName": "user@example.com",
          "datePattern": "dd/MM/yyyy",
          "decimalSeparator": "COMMA",
          "fractionDigits": 2,
          "timeZone": "America/Montevideo",
          "timeZoneOffset": -180,
          "period": "MONTH",
          "autoPost": false,
          "visibility": "PRIVATE",
          "permission": "OWNER",
          "properties": {
            "exc_code": "USD",
            "exc_base": "true"
          },
          "accounts": [
            {
              "createdAt": "1774978949927",
              "id": "2918047099",
              "name": "TESTE BRUNO",
              "normalizedName": "teste_bruno",
              "credit": false,
              "permanent": true,
              "archived": false,
              "hasTransactionPosted": false,
              "type": "ASSET",
              "balanceVerified": true,
              "groups": [
                {
                  "createdAt": "1774996598669",
                  "id": "2922857006",
                  "name": "GROUP TEST",
                  "normalizedName": "group_test",
                  "properties": {},
                  "hidden": false,
                  "locked": false,
                  "hasAccounts": true,
                  "hasGroups": false,
                  "credit": false,
                  "permanent": true,
                  "mixed": false,
                  "type": "ASSET"
                }
              ]
            }
          ],
          "groups": [],
          "collection": {
            "id": "abc123",
            "name": "My Collection",
            "ownerUsername": "user@example.com",
            "permission": "OWNER",
            "books": [
              {
                "id": "agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICA4PT116AJDA",
                "name": "TP Prueba Import Bot USD",
                "ownerName": "user@example.com",
                "datePattern": "dd/MM/yyyy",
                "decimalSeparator": "COMMA",
                "fractionDigits": 2,
                "timeZone": "America/Montevideo",
                "timeZoneOffset": -180,
                "period": "MONTH",
                "autoPost": false,
                "visibility": "PRIVATE",
                "permission": "OWNER",
                "properties": { "exc_code": "USD", "exc_base": "true" },
                "accounts": [],
                "groups": [],
                "totalTransactions": 142,
                "totalTransactionsCurrentMonth": 5,
                "totalTransactionsCurrentYear": 38
              }
            ]
          },
          "createdAt": "1704067200000",
          "updatedAt": "1711929600000",
          "totalTransactions": 142,
          "totalTransactionsCurrentMonth": 5,
          "totalTransactionsCurrentYear": 38
        },
        "account": {
          "id": "2768397104",
          "name": "Bank Safra - USD - Cash 3384",
          "properties": {
            "type": "ASSET",
            "group": "Cash"
          }
        },
        "group": {
          "id": "2922857006",
          "name": "GROUP TEST",
          "normalizedName": "group_test",
          "properties": {
            "institution": "Safra"
          },
          "hidden": false,
          "locked": false,
          "hasAccounts": true,
          "type": "ASSET"
        },
        "file": {
          "id": "9e050776-b152-4fa9-9ceb-14cdda5c7ceb",
          "name": "bank_statement.csv",
          "content": "ZGF0ZSxhbW91bnQsZGVzY3JpcHRpb24KMjAyNC0wMS0wMiwxNzkwMDAuMDAsVU5JVEVEIFNUQVRFUyBUUkVBU1VSWQoyMDI0LTAxLTMwLDQ0OTgzNy42NyxCVVkgNDU1MDAwIEAgOTguNzU1NQ==",
          "contentType": "text/csv"
        }
      }'
```

### Response Format

All parser responses follow the same envelope. The purpose-specific parser URL determines which part the agent consumes:

- `agent_parser_url_transaction` consumes `data.transaction`.
- `agent_parser_url_transactions` consumes `data.transactions`.
- `agent_parser_url_file` consumes `file.properties`.

```json
{
    "success": true,
    "data": {
        "transaction": {},
        "transactions": []
    },
    "file": {
        "properties": {
            ["string"]: "string"
        }
    }
}
```

A single endpoint may return more than one section for backward-friendly implementations. The agent ignores sections that do not match the configured parser purpose.

#### Error Response

```json
{
    "success": false,
    "error": {
        "code": "ERROR_CODE",
        "message": "Human-readable error message",
        "details": {
            // Additional error context
        }
    }
}
```

#### Success Response Example

**Status Code**: `200 OK`

```json
{
    "success": true,
    "data": {
        "transactions": [
            {
                "date": "2024-01-02",
                "description": "UNITED STATES TREASURY BILL RE-ISSUE 12/05/2023 REDEMPTION @ PAR TREA:20001783 Security Number: 912797HX8",
                "amount": 179000.0,
                "properties": {
                    "trade_date": "2024-01-02",
                    "quantity": 179000
                },
                "book_id": "agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICA4PT116AJDA",
                "account_name": "Bank Safra - USD - Cash 3384"
            },
            {
                "date": "2024-01-30",
                "description": "BUY 455000 @ 98.7555 UNITED STATES TREASURY BILL RE-ISSUE 01/25/2024 0% 04/25/2024 DUE: 04/25/2024 SECURITY NUMBER: 912797HG5 TAG: A1149",
                "amount": -449837.67,
                "properties": {
                    "trade_date": "2024-01-30",
                    "quantity": 455000
                },
                "book_id": "agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICA4PT116AJDA",
                "account_name": "Bank Safra - USD - Cash 3384"
            },
            {
                "date": "2024-01-16",
                "description": "CUSTODY FEE AS OF 12/31/23",
                "amount": -531.21
            }
        ]
    },
    "file": {
        "properties": {
            "statement_period": "2024-01",
            "bank_name": "Safra",
            "account_number": "3384"
        }
    }
}
```

## Transaction Data Structure

### Transaction Object

| Field         | Type   | Required | Description                                                                                              |
| ------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `date`        | String | Yes      | Transaction date in ISO format (YYYY-MM-DD)                                                              |
| `description` | String | Yes      | Human-readable transaction description                                                                   |
| `amount`      | Number | Yes      | Transaction amount (positive for credit, negative for debit)                                             |
| `properties`  | Object | No       | Key-value pairs for additional transaction metadata                                                      |
| `book_id`     | String | No       | Target book ID; if omitted, defaults to the request's `book.id`           |
| `account_name`| String | No       | Target account name; if omitted, defaults to the request's `account.name` |

> **Routing Behavior**: Each transaction can optionally specify a different `book_id` and/or `account_name` to route the transaction to a different book or account than where the file was uploaded. If these fields are omitted, the transaction is recorded to the default book and account from the request.

### Properties Object

Common property keys:

- `trade_date`: Trade date
- `quantity`: Traded quantity

### File Object

The `file` object is an optional partial representation of the Bkper `File` interface. Currently only the `properties` field is supported. Every key/value pair in `properties` is stored verbatim as `File.properties` on the processed Bkper file, making it queryable and visible inside Bkper after processing.

| Field             | Type   | Required | Description                                                              |
| ----------------- | ------ | -------- | ------------------------------------------------------------------------ |
| `file`            | Object | No       | Partial `File` object to be merged into the processed Bkper file         |
| `file.properties` | Object | No       | Key/value pairs stored as `File.properties` on the processed Bkper file  |

Common example keys for `file.properties`:

- `statement_period`: The period covered by the statement (e.g. `"2024-01"`)
- `bank_name`: Name of the issuing bank (e.g. `"Safra"`)
- `account_number`: Bank account number referenced in the file (e.g. `"3384"`)

> **Note**: All values must be strings. The `file` object and its `properties` field may be omitted if there is no file-level metadata to record. The `transactions_summary` key is reserved for Bookbot: external file-properties responses cannot set or override it. Bookbot generates the property after creating non-zero transactions, for both multi-transaction and single-transaction extractions. Each entry is grouped by target book/account and contains the non-zero transaction count and native Bkper transaction IDs returned by transaction creation; a single-transaction extraction has one entry. Zero-amount transactions are excluded from the summary, and files containing only zero-amount transactions do not receive one. If the fetched file already has `transactions_summary`, Bookbot skips parsing it again.

## Error Handling

### HTTP Status Codes

| Code | Description                                     |
| ---- | ----------------------------------------------- |
| 400  | Bad Request - Invalid parameters or file format |
| 401  | Unauthorized - Invalid or missing API token     |
| 413  | Payload Too Large - File size exceeds limit     |
| 422  | Unprocessable Entity - File cannot be processed |
| 429  | Too Many Requests - Rate limit exceeded         |
| 500  | Internal Server Error - Server processing error |

## Error Codes

| Code                      | Description                            |
| ------------------------- | -------------------------------------- |
| `INVALID_FILE_FORMAT`     | Unsupported file format                |
| `FILE_TOO_LARGE`          | File exceeds size limit (10MB)         |
| `CORRUPTED_FILE`          | File is corrupted or unreadable        |
| `INVALID_BASE64_ENCODING` | File content is not valid base64       |
| `MALFORMED_JSON`          | Invalid JSON structure in request body |
| `MISSING_FILE_CONTENT`    | Required file.content field is missing |
| `MIME_TYPE_MISMATCH`      | File type doesn't match content        |
| `NO_TRANSACTIONS_FOUND`   | No transactions detected in file       |
| `PROCESSING_TIMEOUT`      | File processing exceeded timeout limit |
| `RATE_LIMIT_EXCEEDED`     | API rate limit exceeded                |
| `AUTHENTICATION_FAILED`   | Invalid or missing API key             |

### Error Response Example

**Status Code**: `400 Bad Request` | `422 Unprocessable Entity` | `500 Internal Server Error`

```json
{
    "success": false,
    "error": {
        "code": "INVALID_FILE_FORMAT",
        "message": "Unsupported file format. Expected CSV, PDF, JPG, or PNG.",
        "details": {
            "file_type": "txt",
            "supported_formats": ["csv", "pdf", "jpg", "png"]
        }
    }
}
```

## File Encoding Requirements

### Base64 Encoding

- **Format**: All files must be base64 encoded in the `file.content` field
- **Size Impact**: Base64 encoding increases file size by approximately 33%

### Supported MIME Types

- **CSV**: `text/csv`
- **PDF**: `application/pdf`
- **JPEG**: `image/jpeg`
- **PNG**: `image/png`

## File Format Support

### CSV Files

- **Encodings**: UTF-8, Latin-1 (ISO-8859-1)
- **Delimiters**: Comma (,), Semicolon (;), Tab (\t)
- **Headers**: Automatic detection
- **Date Formats**: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YY
- **Amount Formats**: 1234.56, 1,234.56, 1.234,56

### PDF/Image Files

- **Formats**: PDF, JPG, PNG
- **Content**: Bank statements, credit card statements
- **OCR**: Automatic text extraction
- **Table Detection**: Automatic transaction table identification

## Security Considerations

- File content must be processed in memory only
- No permanent storage of uploaded files
- API keys must use secure authentication
- Rate limiting to prevent abuse
- Input validation and sanitization
