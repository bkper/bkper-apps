# Bkper Inventory Bot

The Inventory Bot automatically tracks inventory items in a dedicated Inventory Book, synchronizing with Financial Books to manage purchases, sales, and calculate Cost of Goods Sold (COGS) using the FIFO method.

Key features include:

- Automatic synchronization between Financial Books and the Inventory Book
- Up to date inventory management with purchases and sales quantity tracking
- Cost of Goods Sold ([COGS](https://www.investopedia.com/terms/c/cogs.asp)) tracking using the FIFO (First-In, First-Out) method
- Support for handling additional costs on purchases and credit note transactions
- Detailed transaction history with purchase and liquidation logs

## Configuration

To configure the Bkper Inventory Bot, ensure the following setup:

### Collection:
   - Both Financial and Inventory Books must reside within the same [Collection](https://help.bkper.com/en/articles/4208937-collections).
   - Define a single Inventory Book per Collection. This book is identified by setting the `inventory_book` property to `true`.

### Properties Interactions:

   The Inventory Bot interacts with various properties to manage and synchronize data effectively. Ensure these properties are correctly set in your books for optimal performance.

   **Book Properties**:
   - **Financial Books**:
     - `exc_code`: **Required** - The exchange code representing the book currency.
   - **Inventory Book**:
     - `inventory_book`: **Required** set to `true` - Identifies the Inventory book of the collection.

   **Group Properties**:
   - `exc_code`: **Required** - Defines the exchange rate code that represents the currency in which the good is accounted for. Each good account to be tracked by the Inventory Bot must reside into a group with this property defined.

   **Transaction Properties**:
- Good purchase transactions:
   - `quantity`: **Required** - The quantity of the inventory item in the transaction.
   - `purchase_invoice`: **Required** - Reference to the purchase invoice number.
   - `purchase_code`: **Required** - The code that identifies the transaction. Also required (and must have the same value) in the additional cost and credit note transactions to reference those transactions for the good purchase transaction. Its value must be equal to the `purchase_invoice` property value in good purchase transactions.
   - `order`: **Optional** - The order of the operation if multiple operations happened on the same day.
- Sale transactions:
   - `good`: **Required** - The account name of the inventory item.
   - `quantity`: **Required** - The quantity of the inventory item in the transaction.
   - `sale_invoice`: **Optional** - Reference to the sale invoice number.
   - `order`: **Optional** - The order of the operation if multiple operations happened on the same day.
- Additional cost transactions:
   - `purchase_code`: **Required** - Since it adds costs to a specific good purchase transaction, it must have the same value as in the good purchase transaction to reference it.
   - `purchase_invoice`: **Required** - Reference to the additional cost invoice number.
   - `order`: **Optional** - The order of the operation if multiple operations happened on the same day.
- Credit note transactions:
   - `purchase_code`: **Required** - Since it deducts costs from a specific good purchase transaction, it must have the same value as in the good purchase transaction to reference it.
   - `credit_note`: **Required** - Indicates this transaction is a credit note and references to its invoice number.
   - `quantity`: **Optional** - The quantity of the inventory item returned in the transaction.
   - `order`: **Optional** - The order of the operation if multiple operations happened on the same day.

**IMPORTANT:** Always remember to check the transaction after recording it (by clicking on the ✓ icon) for the bot to perform its actions.

## Cost of Sales Service

The Inventory Bot uses the FIFO ([First-In, First-Out](https://medium.com/magnimetrics/first-in-first-out-fifo-inventory-costing-f0bc00096a59)) method to calculate Cost of Goods Sold, ensuring accurate tracking of inventory costs.

### Key Features:

- **Automatic COGS Calculation**: When a sale transaction is detected, the bot automatically determines the cost of the goods sold based on the oldest purchases still in inventory.

- **Purchase and Liquidation Logs**: The bot maintains detailed logs of all purchase and sale transactions, providing an audit trail of inventory movements.

- **Additional Costs Support**: The system can account for additional costs associated with inventory items, ensuring accurate cost calculations.

- **Credit Notes Handling**: Support for credit notes allows for proper adjustment of inventory when goods are returned.

**Important:**
The Inventory Bot automatically adds properties to transactions in the Inventory Book when calculating cost of sales. These properties are used for state and log control. It also manages transaction states by checking/unchecking transactions (see [Transaction States](https://help.bkper.com/en/articles/2569149-transaction-status)). These properties and states **must not** be manually altered.

**As a rule of thumb:** only make edits, updates, deletes on the Financial book and never on the Inventory book.

## Using the Inventory Bot

To use the Inventory Bot:

1. **Set up your books**: Ensure your Financial Books and Inventory Book are properly configured with the required properties.

2. **Record transactions**: When recording purchase and sale transactions in your Financial Books, include the required properties (`good`, `quantity`, etc.).

3. **Calculate COGS**: Use the bot's interface (in the **More** menu) to calculate Cost of Goods Sold for inventory accounts. This can be done for:
   - A specific account
   - All accounts in a group
   - All inventory accounts

4. **Review results**: The bot provides detailed results of its calculations, showing the cost of goods sold for each account.

5. **Reset if needed**: If you need to recalculate COGS for any reason, you can use the reset function to clear previous calculations and start fresh.