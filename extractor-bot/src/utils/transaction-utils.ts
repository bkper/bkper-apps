import { Transaction, Account, Amount, AccountType } from "bkper-js";

export function setAccountBasedOnAmount(transaction: Transaction, account: Account | undefined, amount: Amount | undefined) {
    if (!account || !amount) {
        return false;
    }

    if (amount.gt(0)) {
        if (account.getType() == AccountType.ASSET) {
            transaction.setDebitAccount(account);
        } else if (account.getType() == AccountType.LIABILITY) {
            transaction.setCreditAccount(account);
        } else if (account.getType() == AccountType.INCOMING) {
            transaction.setCreditAccount(account);
        } else if (account.getType() == AccountType.OUTGOING) {
            transaction.setDebitAccount(account);
        }
        return true;
    } else if (amount.lt(0)) {
        if (account.getType() == AccountType.ASSET) {
            transaction.setCreditAccount(account);
        } else if (account.getType() == AccountType.LIABILITY) {
            transaction.setDebitAccount(account);
        } else if (account.getType() == AccountType.INCOMING) {
            transaction.setDebitAccount(account);
        } else if (account.getType() == AccountType.OUTGOING) {
            transaction.setCreditAccount(account);
        }
        return true;
    }
    return false;
}

export async function getAmountSignFromAccountSide(transaction: Transaction, account: Account | null): Promise<Amount | undefined> {
    if (!account) {
        return transaction.getAmount();
    }
    const debitAccount = await transaction.getDebitAccount();
    const creditAccount = await transaction.getCreditAccount();
    const accountType = account.getType();
    const amount = transaction.getAmount();

    // Check if account is on debit side
    if (debitAccount?.getId() === account.getId()) {
        if (accountType === AccountType.ASSET || accountType === AccountType.OUTGOING) {
            return amount;
        } else if (accountType === AccountType.LIABILITY || accountType === AccountType.INCOMING) {
            return amount?.times(-1);
        }
    }

    // Check if account is on credit side
    if (creditAccount?.getId() === account.getId()) {
        if (accountType === AccountType.ASSET || accountType === AccountType.OUTGOING) {
            return amount?.times(-1);
        } else if (accountType === AccountType.LIABILITY || accountType === AccountType.INCOMING) {
            return amount;
        }
    }

    return amount;
}
