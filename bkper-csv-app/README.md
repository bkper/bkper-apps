# Bkper CSV App

Export transactions from the current Bkper Book view to a CSV file.

## What it does

The app adds an **Export CSV** option to the Book menu. When opened, it uses the current Book context and transaction query, then lets you choose export options before downloading a CSV file.

## How to use

1. Install the app in a Bkper Book.
2. Open the Book transactions page.
3. Optionally apply a search query or date range for the transactions you want to export.
4. Choose **Export CSV** from the Book menu.
5. Review the export options and click **Export CSV**.

By default, the export uses semicolon-separated values, Book-formatted dates and amounts, and the standard transaction columns.

## Notes

When no query is selected, the app exports all transactions in the Book.

This app is export-only. It does not import CSV files or create transactions.
