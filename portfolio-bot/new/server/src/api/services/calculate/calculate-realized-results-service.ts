import { Amount, Transaction, type Book } from 'bkper-js';
import {
    DATE_PROP,
    EXC_AGGREGATE_PROP,
    FWD_PURCHASE_AMOUNT_PROP,
    FWD_PURCHASE_EXC_RATE_PROP,
    FWD_PURCHASE_LOG_PROP,
    FWD_PURCHASE_PRICE_PROP,
    FWD_SALE_AMOUNT_PROP,
    FWD_SALE_EXC_RATE_PROP,
    FWD_SALE_PRICE_PROP,
    GAIN_AMOUNT_HIST_PROP,
    GAIN_AMOUNT_PROP,
    LIQUIDATION_LOG_PROP,
    ORDER_PROP,
    PARENT_ID,
    PURCHASE_AMOUNT_PROP,
    PURCHASE_EXC_RATE_PROP,
    PURCHASE_LOG_PROP,
    PURCHASE_PRICE_HIST_PROP,
    PURCHASE_PRICE_PROP,
    SALE_AMOUNT_PROP,
    SALE_DATE_PROP,
    SALE_EXC_RATE_PROP,
    SALE_PRICE_PROP,
    SHORT_SALE_PROP,
} from '../../../shared/constants.js';
import { BotService } from '../bot-service.js';
import type { StockAccount } from '../stock-account.js';
import type { Summary } from '../summary.js';
import type { CalculateRealizedResultsProcessor } from './calculate-realized-results-processor.js';
import { CalculateRealizedResultsSupport } from './calculate-realized-results-support.js';
import { CalculationModel, type LiquidationLogEntry, type PurchaseLogEntry } from './types.js';

export class CalculateRealizedResultsService {
    private readonly botService = new BotService();
    private readonly support = new CalculateRealizedResultsSupport();

    constructor() {}

    private async processSale(
        baseBook: Book,
        financialBook: Book,
        stockExcCode: string,
        stockBook: Book,
        stockAccount: StockAccount,
        saleTransaction: Transaction,
        purchaseTransactions: Transaction[],
        summary: Summary,
        autoMtM: boolean,
        model: CalculationModel,
        processor: CalculateRealizedResultsProcessor
    ): Promise<void> {
        // Log operation status
        console.log(`processing sale: ${saleTransaction.getId()}`);

        // Sale info: quantity, prices, exchange rates
        let soldQuantity = saleTransaction.getAmount()!;
        const salePrice = this.botService.getHistSalePrice(saleTransaction);
        const fwdSalePrice = this.botService.getSalePrice(saleTransaction);
        const saleExcRate = (await this.botService.getExcRate(
            baseBook,
            financialBook,
            saleTransaction,
            SALE_EXC_RATE_PROP
        ))!;
        const fwdSaleExcRate = this.botService.getFwdExcRate(
            saleTransaction,
            FWD_SALE_EXC_RATE_PROP,
            saleExcRate
        );

        let purchaseTotal = new Amount(0);
        let saleTotal = new Amount(0);

        // Historical gain
        let histGainTotal = new Amount(0);
        let histGainBaseNoFxTotal = new Amount(0);
        let histGainBaseWithFxTotal = new Amount(0);
        // Fair gain
        let gainTotal = new Amount(0);
        let gainBaseNoFxTotal = new Amount(0);
        let gainBaseWithFxTotal = new Amount(0);

        let fwdPurchaseTotal = new Amount(0);
        let fwdSaleTotal = new Amount(0);

        const excAggregateProp = baseBook.getProperty(EXC_AGGREGATE_PROP);
        // Unrealized accounts
        const unrealizedAccount = await this.support.getUnrealizedAccount(
            financialBook,
            stockAccount
        );
        const unrealizedFxBaseAccount = await this.support.getUnrealizedFxBaseAccount(
            baseBook,
            stockAccount,
            excAggregateProp
        );
        // Unrealized Hist accounts - only needed if calculating BOTH historical and fair results
        const unrealizedHistAccount = (
            model === CalculationModel.BOTH
                ? await this.support.getUnrealizedHistAccount(financialBook, stockAccount)
                : null
        )!;
        const unrealizedFxHistBaseAccount = (
            model === CalculationModel.BOTH
                ? await this.support.getUnrealizedFxHistBaseAccount(
                      baseBook,
                      stockAccount,
                      excAggregateProp
                  )
                : null
        )!;

        let purchaseLogEntries: PurchaseLogEntry[] = [];
        let fwdPurchaseLogEntries: PurchaseLogEntry[] = [];

        let shortSaleLiquidationLogEntries: LiquidationLogEntry[] = [];

        // Control liquidation status
        let purchaseProcessed = false;

        for (const purchaseTransaction of purchaseTransactions) {
            // Log operation status
            console.log(`processing purchase: ${purchaseTransaction.getId()}`);

            let longSaleLiquidationLogEntries: LiquidationLogEntry[] = [];

            if (purchaseTransaction.isChecked()) {
                // Only process unchecked purchases
                continue;
            }

            // Processing purchase
            purchaseProcessed = true;

            const shortSale = this.support.isShortSale(purchaseTransaction, saleTransaction);

            // Purchase info: quantity, prices, exchange rates
            const purchasePrice = this.botService.getHistPurchasePrice(purchaseTransaction);
            const fwdPurchasePrice = this.botService.getPurchasePrice(purchaseTransaction);
            const purchaseExcRate = (await this.botService.getExcRate(
                baseBook,
                financialBook,
                purchaseTransaction,
                PURCHASE_EXC_RATE_PROP
            ))!;
            const fwdPurchaseExcRate = this.botService.getFwdExcRate(
                purchaseTransaction,
                FWD_PURCHASE_EXC_RATE_PROP,
                purchaseExcRate
            );

            const purchaseQuantity = purchaseTransaction.getAmount()!;

            // Sold quantity GTE purchase quantity: update & check purchase transaction
            if (soldQuantity.gte(purchaseQuantity)) {
                const saleAmount = salePrice.times(purchaseQuantity);
                const purchaseAmount = purchasePrice.times(purchaseQuantity);
                const fwdSaleAmount = fwdSalePrice.times(purchaseQuantity);
                const fwdPurchaseAmount = fwdPurchasePrice.times(purchaseQuantity);

                // Historical gain
                let histGain = saleAmount.minus(purchaseAmount);
                let histGainBaseNoFx = this.botService.calculateGainBaseNoFX(
                    histGain,
                    purchaseExcRate,
                    saleExcRate,
                    shortSale
                );
                let histGainBaseWithFx = this.botService.calculateGainBaseWithFX(
                    purchaseAmount,
                    purchaseExcRate,
                    saleAmount,
                    saleExcRate
                );

                // Fair gain
                let gain = fwdSaleAmount.minus(fwdPurchaseAmount);
                let gainBaseNoFx = this.botService.calculateGainBaseNoFX(
                    gain,
                    fwdPurchaseExcRate,
                    fwdSaleExcRate,
                    shortSale
                );
                let gainBaseWithFx = this.botService.calculateGainBaseWithFX(
                    fwdPurchaseAmount,
                    fwdPurchaseExcRate,
                    fwdSaleAmount,
                    fwdSaleExcRate
                );

                if (!shortSale) {
                    purchaseTotal = purchaseTotal.plus(purchaseAmount);
                    saleTotal = saleTotal.plus(saleAmount);
                    fwdPurchaseTotal = fwdPurchaseTotal.plus(fwdPurchaseAmount);
                    fwdSaleTotal = fwdSaleTotal.plus(fwdSaleAmount);

                    // Historical
                    histGainTotal = histGainTotal.plus(histGain);
                    histGainBaseNoFxTotal = histGainBaseNoFxTotal.plus(histGainBaseNoFx);
                    histGainBaseWithFxTotal = histGainBaseWithFxTotal.plus(histGainBaseWithFx);
                    // Fair
                    gainTotal = gainTotal.plus(gain);
                    gainBaseNoFxTotal = gainBaseNoFxTotal.plus(gainBaseNoFx);
                    gainBaseWithFxTotal = gainBaseWithFxTotal.plus(gainBaseWithFx);

                    purchaseLogEntries.push(
                        this.support.logPurchase(
                            stockBook,
                            purchaseQuantity,
                            purchasePrice,
                            purchaseTransaction,
                            purchaseExcRate
                        )
                    );
                    if (fwdPurchasePrice) {
                        fwdPurchaseLogEntries.push(
                            this.support.logPurchase(
                                stockBook,
                                purchaseQuantity,
                                fwdPurchasePrice,
                                purchaseTransaction,
                                fwdPurchaseExcRate!
                            )
                        );
                    } else {
                        fwdPurchaseLogEntries.push(
                            this.support.logPurchase(
                                stockBook,
                                purchaseQuantity,
                                purchasePrice,
                                purchaseTransaction,
                                purchaseExcRate
                            )
                        );
                    }
                }

                purchaseTransaction
                    .setProperty(PURCHASE_AMOUNT_PROP, purchaseAmount.toString())
                    .setProperty(PURCHASE_EXC_RATE_PROP, purchaseExcRate?.toString())
                    .setProperty(FWD_PURCHASE_AMOUNT_PROP, fwdPurchaseAmount?.toString());
                // Avoid overriding purchase_price prop when purchase_price_hist value is present
                if (!purchaseTransaction.getProperty(PURCHASE_PRICE_HIST_PROP)) {
                    purchaseTransaction.setProperty(PURCHASE_PRICE_PROP, purchasePrice.toString());
                }
                if (shortSale) {
                    shortSaleLiquidationLogEntries.push(
                        this.support.logLiquidation(
                            purchaseTransaction,
                            purchasePrice,
                            purchaseExcRate
                        )
                    );
                    purchaseTransaction
                        .setProperty(SALE_PRICE_PROP, salePrice.toString())
                        .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                        .setProperty(SALE_AMOUNT_PROP, saleAmount.toString())
                        .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString())
                        .setProperty(FWD_SALE_PRICE_PROP, fwdSalePrice?.toString())
                        .setProperty(FWD_SALE_AMOUNT_PROP, fwdSaleAmount?.toString())
                        .setProperty(
                            SALE_DATE_PROP,
                            saleTransaction.getProperty(DATE_PROP) || saleTransaction.getDate()
                        )
                        .setProperty(SHORT_SALE_PROP, 'true');
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical gain only - use standard property key
                        purchaseTransaction.setProperty(GAIN_AMOUNT_PROP, histGain.toString());
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair gain only - use standard property key
                        purchaseTransaction.setProperty(GAIN_AMOUNT_PROP, gain.toString());
                    } else {
                        // Record both gains - each one uses its own property key
                        purchaseTransaction
                            .setProperty(GAIN_AMOUNT_HIST_PROP, histGain.toString())
                            .setProperty(GAIN_AMOUNT_PROP, gain.toString());
                    }
                } else {
                    longSaleLiquidationLogEntries.push(
                        this.support.logLiquidation(saleTransaction, salePrice, saleExcRate)
                    );
                    purchaseTransaction.setProperty(
                        LIQUIDATION_LOG_PROP,
                        JSON.stringify(longSaleLiquidationLogEntries)
                    );
                }

                // Store transaction to be updated
                purchaseTransaction.setChecked(true);
                processor.setStockBookTransactionToUpdate(purchaseTransaction);

                if (shortSale) {
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical results only - use standard accounts and remoteId prefixes
                        await this.support.addRealizedResult(
                            baseBook,
                            stockAccount,
                            financialBook,
                            unrealizedAccount,
                            purchaseTransaction,
                            histGain,
                            histGainBaseNoFx,
                            false,
                            processor
                        );
                        await this.support.addFxResult(
                            stockAccount,
                            stockExcCode,
                            baseBook,
                            unrealizedFxBaseAccount,
                            purchaseTransaction,
                            histGainBaseWithFx,
                            histGainBaseNoFx,
                            summary,
                            false,
                            processor
                        );
                        if (autoMtM) {
                            await this.support.addMarkToMarket(
                                stockBook,
                                purchaseTransaction,
                                stockAccount,
                                financialBook,
                                unrealizedAccount,
                                purchasePrice,
                                false,
                                processor
                            );
                        }
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair results only - use standard accounts and remoteId prefixes
                        await this.support.addRealizedResult(
                            baseBook,
                            stockAccount,
                            financialBook,
                            unrealizedAccount,
                            purchaseTransaction,
                            gain,
                            gainBaseNoFx,
                            false,
                            processor
                        );
                        await this.support.addFxResult(
                            stockAccount,
                            stockExcCode,
                            baseBook,
                            unrealizedFxBaseAccount,
                            purchaseTransaction,
                            gainBaseWithFx,
                            gainBaseNoFx,
                            summary,
                            false,
                            processor
                        );
                        if (autoMtM) {
                            await this.support.addMarkToMarket(
                                stockBook,
                                purchaseTransaction,
                                stockAccount,
                                financialBook,
                                unrealizedAccount,
                                purchasePrice,
                                false,
                                processor
                            );
                        }
                    } else {
                        // Record both results - each one uses its accounts and remoteId prefixes
                        await this.support.addRealizedResult(
                            baseBook,
                            stockAccount,
                            financialBook,
                            unrealizedHistAccount,
                            purchaseTransaction,
                            histGain,
                            histGainBaseNoFx,
                            true,
                            processor
                        );
                        await this.support.addRealizedResult(
                            baseBook,
                            stockAccount,
                            financialBook,
                            unrealizedAccount,
                            purchaseTransaction,
                            gain,
                            gainBaseNoFx,
                            false,
                            processor
                        );
                        await this.support.addFxResult(
                            stockAccount,
                            stockExcCode,
                            baseBook,
                            unrealizedFxHistBaseAccount,
                            purchaseTransaction,
                            histGainBaseWithFx,
                            histGainBaseNoFx,
                            summary,
                            true,
                            processor
                        );
                        await this.support.addFxResult(
                            stockAccount,
                            stockExcCode,
                            baseBook,
                            unrealizedFxBaseAccount,
                            purchaseTransaction,
                            gainBaseWithFx,
                            gainBaseNoFx,
                            summary,
                            false,
                            processor
                        );
                        if (autoMtM) {
                            await this.support.addMarkToMarket(
                                stockBook,
                                purchaseTransaction,
                                stockAccount,
                                financialBook,
                                unrealizedHistAccount,
                                purchasePrice,
                                true,
                                processor
                            );
                            await this.support.addMarkToMarket(
                                stockBook,
                                purchaseTransaction,
                                stockAccount,
                                financialBook,
                                unrealizedAccount,
                                purchasePrice,
                                false,
                                processor
                            );
                        }
                    }
                }

                soldQuantity = soldQuantity.minus(purchaseQuantity);

                // Sold quantity LT purchase quantity: update purchase + update & check splitted purchase transaction
            } else {
                let remainingBuyQuantity = purchaseQuantity.minus(soldQuantity);
                let partialBuyQuantity = purchaseQuantity.minus(remainingBuyQuantity);

                const saleAmount = salePrice.times(partialBuyQuantity);
                const purchaseAmount = purchasePrice.times(partialBuyQuantity);
                const fwdSaleAmount = fwdSalePrice.times(partialBuyQuantity);
                const fwdPurchaseAmount = fwdPurchasePrice.times(partialBuyQuantity);

                // Historical
                let histGain = saleAmount.minus(purchaseAmount);
                let histGainBaseNoFx = this.botService.calculateGainBaseNoFX(
                    histGain,
                    purchaseExcRate,
                    saleExcRate,
                    shortSale
                );
                let histGainBaseWithFx = this.botService.calculateGainBaseWithFX(
                    purchaseAmount,
                    purchaseExcRate,
                    saleAmount,
                    saleExcRate
                );
                // Fair
                let gain = fwdSaleAmount.minus(fwdPurchaseAmount);
                let gainBaseNoFx = this.botService.calculateGainBaseNoFX(
                    gain,
                    fwdPurchaseExcRate,
                    fwdSaleExcRate,
                    shortSale
                );
                let gainBaseWithFx = this.botService.calculateGainBaseWithFX(
                    fwdPurchaseAmount,
                    fwdPurchaseExcRate,
                    fwdSaleAmount,
                    fwdSaleExcRate
                );

                purchaseTransaction
                    .setAmount(remainingBuyQuantity)
                    .setProperty(PURCHASE_EXC_RATE_PROP, purchaseExcRate?.toString())
                    .setProperty(FWD_PURCHASE_EXC_RATE_PROP, fwdPurchaseExcRate?.toString());
                // Store transaction to be updated
                processor.setStockBookTransactionToUpdate(purchaseTransaction);

                let splittedPurchaseTransaction = new Transaction(stockBook)
                    .setDate(purchaseTransaction.getDate()!)
                    .setAmount(partialBuyQuantity)
                    .setCreditAccount(await purchaseTransaction.getCreditAccount())
                    .setDebitAccount(await purchaseTransaction.getDebitAccount())
                    .setDescription(purchaseTransaction.getDescription())
                    .setProperty(ORDER_PROP, purchaseTransaction.getProperty(ORDER_PROP))
                    .setProperty(DATE_PROP, purchaseTransaction.getProperty(DATE_PROP))
                    .setProperty(PARENT_ID, purchaseTransaction.getId())
                    .setProperty(PURCHASE_PRICE_PROP, purchasePrice.toString())
                    .setProperty(PURCHASE_AMOUNT_PROP, purchaseAmount.toString())
                    .setProperty(PURCHASE_EXC_RATE_PROP, purchaseExcRate?.toString())
                    .setProperty(FWD_PURCHASE_PRICE_PROP, fwdPurchasePrice?.toString())
                    .setProperty(FWD_PURCHASE_AMOUNT_PROP, fwdPurchaseAmount?.toString())
                    .setProperty(FWD_PURCHASE_EXC_RATE_PROP, fwdPurchaseExcRate?.toString());
                if (shortSale) {
                    splittedPurchaseTransaction
                        .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                        .setProperty(SALE_PRICE_PROP, salePrice.toString())
                        .setProperty(SALE_AMOUNT_PROP, saleAmount.toString())
                        .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString())
                        .setProperty(FWD_SALE_PRICE_PROP, fwdSalePrice?.toString())
                        .setProperty(FWD_SALE_AMOUNT_PROP, fwdSaleAmount?.toString())
                        .setProperty(
                            SALE_DATE_PROP,
                            saleTransaction.getProperty(DATE_PROP) || saleTransaction.getDate()
                        )
                        .setProperty(SHORT_SALE_PROP, 'true');
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical gain only - use standard property key
                        splittedPurchaseTransaction.setProperty(
                            GAIN_AMOUNT_PROP,
                            histGain.toString()
                        );
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair gain only - use standard property key
                        splittedPurchaseTransaction.setProperty(GAIN_AMOUNT_PROP, gain.toString());
                    } else {
                        // Record both gains - each one uses its own property key
                        splittedPurchaseTransaction
                            .setProperty(GAIN_AMOUNT_HIST_PROP, histGain.toString())
                            .setProperty(GAIN_AMOUNT_PROP, gain.toString());
                    }
                } else {
                    longSaleLiquidationLogEntries.push(
                        this.support.logLiquidation(saleTransaction, salePrice, saleExcRate)
                    );
                    splittedPurchaseTransaction.setProperty(
                        LIQUIDATION_LOG_PROP,
                        JSON.stringify(longSaleLiquidationLogEntries)
                    );
                }

                // Store transaction to be created: generate temporaty id in order to wrap up connections later
                splittedPurchaseTransaction
                    .setChecked(true)
                    .addRemoteId(`${processor.generateTemporaryId()}`);
                processor.setStockBookTransactionToCreate(splittedPurchaseTransaction);

                if (shortSale) {
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical results only - use standard accounts and remoteId prefixes
                        await this.support.addRealizedResult(
                            baseBook,
                            stockAccount,
                            financialBook,
                            unrealizedAccount,
                            splittedPurchaseTransaction,
                            histGain,
                            histGainBaseNoFx,
                            false,
                            processor
                        );
                        await this.support.addFxResult(
                            stockAccount,
                            stockExcCode,
                            baseBook,
                            unrealizedFxBaseAccount,
                            splittedPurchaseTransaction,
                            histGainBaseWithFx,
                            histGainBaseNoFx,
                            summary,
                            false,
                            processor
                        );
                        if (autoMtM) {
                            await this.support.addMarkToMarket(
                                stockBook,
                                splittedPurchaseTransaction,
                                stockAccount,
                                financialBook,
                                unrealizedAccount,
                                purchasePrice,
                                false,
                                processor
                            );
                        }
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair results only - use standard accounts and remoteId prefixes
                        await this.support.addRealizedResult(
                            baseBook,
                            stockAccount,
                            financialBook,
                            unrealizedAccount,
                            splittedPurchaseTransaction,
                            gain,
                            gainBaseNoFx,
                            false,
                            processor
                        );
                        await this.support.addFxResult(
                            stockAccount,
                            stockExcCode,
                            baseBook,
                            unrealizedFxBaseAccount,
                            splittedPurchaseTransaction,
                            gainBaseWithFx,
                            gainBaseNoFx,
                            summary,
                            false,
                            processor
                        );
                        if (autoMtM) {
                            await this.support.addMarkToMarket(
                                stockBook,
                                splittedPurchaseTransaction,
                                stockAccount,
                                financialBook,
                                unrealizedAccount,
                                purchasePrice,
                                false,
                                processor
                            );
                        }
                    } else {
                        // Record both results - each one uses its accounts and remoteId prefixes
                        await this.support.addRealizedResult(
                            baseBook,
                            stockAccount,
                            financialBook,
                            unrealizedHistAccount,
                            splittedPurchaseTransaction,
                            histGain,
                            histGainBaseNoFx,
                            true,
                            processor
                        );
                        await this.support.addRealizedResult(
                            baseBook,
                            stockAccount,
                            financialBook,
                            unrealizedAccount,
                            splittedPurchaseTransaction,
                            gain,
                            gainBaseNoFx,
                            false,
                            processor
                        );
                        await this.support.addFxResult(
                            stockAccount,
                            stockExcCode,
                            baseBook,
                            unrealizedFxHistBaseAccount,
                            splittedPurchaseTransaction,
                            histGainBaseWithFx,
                            histGainBaseNoFx,
                            summary,
                            true,
                            processor
                        );
                        await this.support.addFxResult(
                            stockAccount,
                            stockExcCode,
                            baseBook,
                            unrealizedFxBaseAccount,
                            splittedPurchaseTransaction,
                            gainBaseWithFx,
                            gainBaseNoFx,
                            summary,
                            false,
                            processor
                        );
                        if (autoMtM) {
                            await this.support.addMarkToMarket(
                                stockBook,
                                splittedPurchaseTransaction,
                                stockAccount,
                                financialBook,
                                unrealizedHistAccount,
                                purchasePrice,
                                true,
                                processor
                            );
                            await this.support.addMarkToMarket(
                                stockBook,
                                splittedPurchaseTransaction,
                                stockAccount,
                                financialBook,
                                unrealizedAccount,
                                purchasePrice,
                                false,
                                processor
                            );
                        }
                    }
                    shortSaleLiquidationLogEntries.push(
                        this.support.logLiquidation(
                            splittedPurchaseTransaction,
                            purchasePrice,
                            purchaseExcRate
                        )
                    );
                }

                soldQuantity = soldQuantity.minus(partialBuyQuantity);

                if (!shortSale) {
                    purchaseTotal = purchaseTotal.plus(purchaseAmount);
                    saleTotal = saleTotal.plus(saleAmount);
                    fwdSaleTotal = fwdSaleTotal.plus(fwdSaleAmount);
                    fwdPurchaseTotal = fwdPurchaseTotal.plus(fwdPurchaseAmount);

                    // Historical
                    histGainTotal = histGainTotal.plus(histGain);
                    histGainBaseNoFxTotal = histGainBaseNoFxTotal.plus(histGainBaseNoFx);
                    histGainBaseWithFxTotal = histGainBaseWithFxTotal.plus(histGainBaseWithFx);
                    // Fair
                    gainTotal = gainTotal.plus(gain);
                    gainBaseNoFxTotal = gainBaseNoFxTotal.plus(gainBaseNoFx);
                    gainBaseWithFxTotal = gainBaseWithFxTotal.plus(gainBaseWithFx);

                    purchaseLogEntries.push(
                        this.support.logPurchase(
                            stockBook,
                            partialBuyQuantity,
                            purchasePrice,
                            purchaseTransaction,
                            purchaseExcRate
                        )
                    );
                    if (fwdPurchasePrice) {
                        fwdPurchaseLogEntries.push(
                            this.support.logPurchase(
                                stockBook,
                                partialBuyQuantity,
                                fwdPurchasePrice,
                                purchaseTransaction,
                                fwdPurchaseExcRate!
                            )
                        );
                    } else {
                        fwdPurchaseLogEntries.push(
                            this.support.logPurchase(
                                stockBook,
                                partialBuyQuantity,
                                purchasePrice,
                                purchaseTransaction,
                                purchaseExcRate
                            )
                        );
                    }
                }
            }

            // Break loop if sale is fully processed, otherwise proceed to next purchase
            if (soldQuantity.lte(0)) {
                break;
            }
        }

        // Sold quantity EQ zero: update & check sale transaction
        if (soldQuantity.round(stockBook.getFractionDigits()).eq(0)) {
            if (shortSaleLiquidationLogEntries.length > 0) {
                saleTransaction
                    .setProperty(
                        LIQUIDATION_LOG_PROP,
                        JSON.stringify(shortSaleLiquidationLogEntries)
                    )
                    .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                    .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString());
            }
            if (purchaseLogEntries.length > 0) {
                saleTransaction
                    .setProperty(PURCHASE_AMOUNT_PROP, purchaseTotal.toString())
                    .setProperty(SALE_AMOUNT_PROP, saleTotal.toString())
                    .setProperty(PURCHASE_LOG_PROP, JSON.stringify(purchaseLogEntries))
                    .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString());
                if (model === CalculationModel.HISTORICAL_ONLY) {
                    // Record historical gain only - use standard property key
                    saleTransaction.setProperty(GAIN_AMOUNT_PROP, histGainTotal.toString());
                } else if (model === CalculationModel.FAIR_ONLY) {
                    // Record fair gain only - use standard property key
                    saleTransaction.setProperty(GAIN_AMOUNT_PROP, gainTotal.toString());
                } else {
                    // Record both gains - each one uses its own property key
                    saleTransaction
                        .setProperty(GAIN_AMOUNT_HIST_PROP, histGainTotal.toString())
                        .setProperty(GAIN_AMOUNT_PROP, gainTotal.toString());
                }
                if (fwdPurchaseLogEntries.length > 0) {
                    saleTransaction
                        .setProperty(
                            FWD_PURCHASE_AMOUNT_PROP,
                            !fwdPurchaseTotal.eq(0) ? fwdPurchaseTotal?.toString() : null
                        )
                        .setProperty(
                            FWD_SALE_AMOUNT_PROP,
                            !fwdSaleTotal.eq(0) ? fwdSaleTotal.toString() : null
                        )
                        .setProperty(FWD_PURCHASE_LOG_PROP, JSON.stringify(fwdPurchaseLogEntries))
                        .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString());
                }
            }

            // Store transaction to be updated
            saleTransaction.setChecked(true);
            processor.setStockBookTransactionToUpdate(saleTransaction);

            // Sold quantity GT zero: update sale + update & check splitted sale transaction
        } else if (soldQuantity.round(stockBook.getFractionDigits()).gt(0)) {
            let remainingSaleQuantity = saleTransaction.getAmount()!.minus(soldQuantity);

            if (!remainingSaleQuantity.eq(0)) {
                saleTransaction
                    .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                    .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString())
                    .setAmount(soldQuantity);
                // Store transaction to be updated
                processor.setStockBookTransactionToUpdate(saleTransaction);

                let splittedSaleTransaction = new Transaction(stockBook)
                    .setDate(saleTransaction.getDate()!)
                    .setAmount(remainingSaleQuantity)
                    .setCreditAccount(await saleTransaction.getCreditAccount())
                    .setDebitAccount(await saleTransaction.getDebitAccount())
                    .setDescription(saleTransaction.getDescription())
                    .setProperty(ORDER_PROP, saleTransaction.getProperty(ORDER_PROP))
                    .setProperty(DATE_PROP, saleTransaction.getProperty(DATE_PROP))
                    .setProperty(PARENT_ID, saleTransaction.getId())
                    .setProperty(SALE_PRICE_PROP, salePrice.toString())
                    .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                    .setProperty(FWD_SALE_PRICE_PROP, fwdSalePrice?.toString())
                    .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString());
                if (shortSaleLiquidationLogEntries.length > 0) {
                    splittedSaleTransaction.setProperty(
                        LIQUIDATION_LOG_PROP,
                        JSON.stringify(shortSaleLiquidationLogEntries)
                    );
                }
                if (purchaseLogEntries.length > 0) {
                    splittedSaleTransaction
                        .setProperty(PURCHASE_AMOUNT_PROP, purchaseTotal.toString())
                        .setProperty(SALE_AMOUNT_PROP, saleTotal.toString())
                        .setProperty(PURCHASE_LOG_PROP, JSON.stringify(purchaseLogEntries));
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical gain only - use standard property key
                        splittedSaleTransaction.setProperty(
                            GAIN_AMOUNT_PROP,
                            histGainTotal.toString()
                        );
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair gain only - use standard property key
                        splittedSaleTransaction.setProperty(GAIN_AMOUNT_PROP, gainTotal.toString());
                    } else {
                        // Record both gains - each one uses its own property key
                        splittedSaleTransaction
                            .setProperty(GAIN_AMOUNT_HIST_PROP, histGainTotal.toString())
                            .setProperty(GAIN_AMOUNT_PROP, gainTotal.toString());
                    }
                    if (fwdPurchaseLogEntries.length > 0) {
                        splittedSaleTransaction
                            .setProperty(
                                FWD_PURCHASE_AMOUNT_PROP,
                                !fwdPurchaseTotal.eq(0) ? fwdPurchaseTotal?.toString() : null
                            )
                            .setProperty(
                                FWD_SALE_AMOUNT_PROP,
                                !fwdSaleTotal.eq(0) ? fwdSaleTotal.toString() : null
                            )
                            .setProperty(
                                FWD_PURCHASE_LOG_PROP,
                                JSON.stringify(fwdPurchaseLogEntries)
                            );
                    }
                }

                // Store transaction to be created: generate temporaty id in order to wrap up connections later
                splittedSaleTransaction
                    .setChecked(true)
                    .addRemoteId(`${processor.generateTemporaryId()}`);
                processor.setStockBookTransactionToCreate(splittedSaleTransaction);

                // Override to have the RR, FX and MTM associated to the splitted tx
                saleTransaction = splittedSaleTransaction;
            }
        }

        if (model === CalculationModel.HISTORICAL_ONLY) {
            // Record historical results only - use standard accounts and remoteId prefixes
            await this.support.addRealizedResult(
                baseBook,
                stockAccount,
                financialBook,
                unrealizedAccount,
                saleTransaction,
                histGainTotal,
                histGainBaseNoFxTotal,
                false,
                processor
            );
            await this.support.addFxResult(
                stockAccount,
                stockExcCode,
                baseBook,
                unrealizedFxBaseAccount,
                saleTransaction,
                histGainBaseWithFxTotal,
                histGainBaseNoFxTotal,
                summary,
                false,
                processor
            );
            if (
                autoMtM &&
                purchaseProcessed &&
                !saleTransaction.getProperty(LIQUIDATION_LOG_PROP)
            ) {
                await this.support.addMarkToMarket(
                    stockBook,
                    saleTransaction,
                    stockAccount,
                    financialBook,
                    unrealizedAccount,
                    salePrice,
                    false,
                    processor
                );
            }
        } else if (model === CalculationModel.FAIR_ONLY) {
            // Record fair results only - use standard accounts and remoteId prefixes
            await this.support.addRealizedResult(
                baseBook,
                stockAccount,
                financialBook,
                unrealizedAccount,
                saleTransaction,
                gainTotal,
                gainBaseNoFxTotal,
                false,
                processor
            );
            await this.support.addFxResult(
                stockAccount,
                stockExcCode,
                baseBook,
                unrealizedFxBaseAccount,
                saleTransaction,
                gainBaseWithFxTotal,
                gainBaseNoFxTotal,
                summary,
                false,
                processor
            );
            if (
                autoMtM &&
                purchaseProcessed &&
                !saleTransaction.getProperty(LIQUIDATION_LOG_PROP)
            ) {
                await this.support.addMarkToMarket(
                    stockBook,
                    saleTransaction,
                    stockAccount,
                    financialBook,
                    unrealizedAccount,
                    salePrice,
                    false,
                    processor
                );
            }
        } else {
            // Record both results - each one uses its accounts and remoteId prefixes
            await this.support.addRealizedResult(
                baseBook,
                stockAccount,
                financialBook,
                unrealizedHistAccount,
                saleTransaction,
                histGainTotal,
                histGainBaseNoFxTotal,
                true,
                processor
            );
            await this.support.addRealizedResult(
                baseBook,
                stockAccount,
                financialBook,
                unrealizedAccount,
                saleTransaction,
                gainTotal,
                gainBaseNoFxTotal,
                false,
                processor
            );
            await this.support.addFxResult(
                stockAccount,
                stockExcCode,
                baseBook,
                unrealizedFxHistBaseAccount,
                saleTransaction,
                histGainBaseWithFxTotal,
                histGainBaseNoFxTotal,
                summary,
                true,
                processor
            );
            await this.support.addFxResult(
                stockAccount,
                stockExcCode,
                baseBook,
                unrealizedFxBaseAccount,
                saleTransaction,
                gainBaseWithFxTotal,
                gainBaseNoFxTotal,
                summary,
                false,
                processor
            );
            if (
                autoMtM &&
                purchaseProcessed &&
                !saleTransaction.getProperty(LIQUIDATION_LOG_PROP)
            ) {
                await this.support.addMarkToMarket(
                    stockBook,
                    saleTransaction,
                    stockAccount,
                    financialBook,
                    unrealizedHistAccount,
                    salePrice,
                    true,
                    processor
                );
                await this.support.addMarkToMarket(
                    stockBook,
                    saleTransaction,
                    stockAccount,
                    financialBook,
                    unrealizedAccount,
                    salePrice,
                    false,
                    processor
                );
            }
        }
    }
}
