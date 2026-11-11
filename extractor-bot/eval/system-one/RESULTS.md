# Clairic extraction trial

Can Clairic, Cloudflare's System One extraction model (preview), read invoices and receipts as well as Extractor Bot does today? This trial reads the same fields from the same synthetic documents with Clairic as first asked (`clairic`), with Clairic given the context the bot has (`clairic-tuned`; `clairic-tuned-dated` with a reference date; `clairic-tuned-notes` with Book notes as well; `clairic-tuned-fields` with the same notes in each field's question instead), both through the Bkper AI gateway's `POST /v1/systemone` (Open System One 2026-11-07), and with Extractor Bot's current path, Gemini Flash through `POST /v1/responses`. It changes nothing in Extractor Bot.

## In short

- Gemini, the bot's current path, read 97% of the fields correctly. Clairic as first asked read 69%. With the context the bot has, it read 90%, and 95% on text documents.
- Context made most of the difference. Code reads the currency, the buyer's name stops Clairic from naming the customer as the supplier, naming the usual labels stops it from missing document numbers, and telling it that a missing date is null stops it from filling in the reference date.
- Clairic is still behind on scanned images and descriptions, so Gemini stays. Clairic is about 8 times faster and 35 times cheaper, and its confident answers on text documents were all right, so a Clairic-first path for text documents is worth testing on real documents.
- Clairic follows a specific rule in free-text Book notes, but reads the notes as part of the document. Put into each field's question instead, the same rules fixed every miss they addressed without that damage, and text documents reached Gemini's 97%. Instructions learned from corrections, as ACE learns them today, would need that per-field shape, and checks against more than one document.

## Method

- 26 synthetic documents (`cases.ts`): 22 plain-text invoices, receipts and emails and 4 rendered images (`images/render.py`); 16 in English and 10 in Portuguese. Tags: receipt 12, invoice 11, missing_fields 9, email 7, number_format 6, image 4, messy 4, distractor_dates 3, yearless_date 2; a document can have several tags. Some fields are deliberately absent: date in 5 documents, total in 2, currency in 3, document number in 5.
- Six fields, the ones Extractor Bot records from an invoice or receipt: date, total, currency, supplier, document number and description. Each is correct, wrong, missed (null where the document states it), hallucinated (a value where it does not) or a correct null. Supplier and description are correct when they contain an accepted name or keyword, ignoring case and accents; document numbers are compared on letters and digits, without a leading `No`, `Nº` or `#`; currencies are normalized to ISO codes, reading a bare `$` as USD.
- Gemini: the bot's `ExtractorInvoice`, unchanged (system prompt, schema, `gemini-flash`, medium reasoning, retries), through `BkperAIResponsesClient` (`gemini.ts`). Books get properties by configuring a transaction prompt, which replaces the default user prompt; the trial's prompt is the default with its "no additional property" rule replaced by `supplier`, `document_number` and `currency`. The bot's schema requires an amount, so an amount of 0 counts as no total. Text documents go in as `text/plain` files and images as `image/png` or `image/jpeg`, as the bot sends them.
- Clairic (`buildClairicRequest`): one request per document with `date`, `number` and `text` questions for the six fields, plus three `list` questions for item amounts, charges and discounts, and `reference_date` 2026-10-31 so year-less dates resolve. An image is an asset, and the state is `Scanned document: document-scan`, naming its placeholder. Clairic is never asked to add anything up: code checks that items plus charges minus discounts equal its total, in cents. Text spans are checked against the state (or `state_text`) in code points.
- Clairic tuned (`buildClairicTunedRequest`): the same documents with the context Extractor Bot has, and with what Clairic does poorly moved to code. The state starts with the buyer, the Book's owner (`buyer` in `cases.ts`), and the supplier question excludes the buyer. Code reads the currency of a text document (`detectCurrency`), so Clairic is asked for it only on images. Code writes the description from the first three item names Clairic lists, because Clairic copies text and cannot summarize. The date question says a document without such a date has none, and the document number question names the usual labels and the numbers it is not. Null thresholds are unchanged. These changes were written after reading the first request's misses on these same documents, so the tuned results are optimistic.
- The two tuned requests differ only by the reference date: `clairic-tuned` sends none, as the bot does, and `clairic-tuned-dated` sends 2026-10-31.
- Book notes (`clairic-tuned-notes`): the dated request with a "Book notes" block between the buyer and the document, shaped like the instructions Extractor Bot learns from corrections and keeps in `agent_parser_transaction` (`BOOK_NOTES` in `request.ts`). Four notes address the dated request's misses on these documents; two come from the bot's Gemini prompt and do not apply to Clairic's questions. The question instructions are unchanged.
- Field notes (`clairic-tuned-fields`): the dated request with each of the four notes that apply appended to its own field's instructions (`FIELD_NOTES` in `request.ts`): date, total, supplier and document number. The two notes that apply to no question are left out, and the state is unchanged.
- Calls: Gemini, 26 live calls on the production gateway on 2026-11-08 (sequential, no retries needed), recorded in `recordings.json` without its encrypted reasoning blobs. Clairic, 130 live calls, all five requests for every document, on the production gateway on 2026-11-09, after the gateway began repairing Clairic answers that contradict themselves; before that, all four image documents failed with HTTP 502. The first request's bodies repeated those of a run earlier that day, and its answers were identical; its median latency of 174 ms suggests the gateway's response cache answered them, so its latency is not comparable. Every other request body was distinct. Earlier runs on the dev gateway on 2026-11-07 and on production on 2026-11-08 otherwise reached the same conclusions. Latency is wall time measured from the caller, including the network. Cost is usage times the gateway catalog price at recording time, which includes Bkper's markup: Clairic 150 nano USD per input token and no output price; Gemini Flash 2,300 per input token and 11,000 per output token, reasoning included.

## Results

<!-- generated:start -->
Generated by `bun eval/system-one/run.ts --write` from `recordings.json` (`clairic` recorded 2026-11-09 at `https://ai.bkper.app/v1/systemone`; `clairic-tuned` recorded 2026-11-09 at `https://ai.bkper.app/v1/systemone`; `clairic-tuned-dated` recorded 2026-11-09 at `https://ai.bkper.app/v1/systemone`; `clairic-tuned-notes` recorded 2026-11-09 at `https://ai.bkper.app/v1/systemone`; `clairic-tuned-fields` recorded 2026-11-09 at `https://ai.bkper.app/v1/systemone`; `gemini-flash` recorded 2026-11-08 at `https://ai.bkper.app/v1/responses`; Open System One 2026-11-07). Do not edit by hand.

### Summary

| Metric | clairic | clairic-tuned | clairic-tuned-dated | clairic-tuned-notes | clairic-tuned-fields | gemini-flash |
| --- | --- | --- | --- | --- | --- | --- |
| Documents (calls, errors) | 26 (26, 0) | 26 (26, 0) | 26 (26, 0) | 26 (26, 0) | 26 (26, 0) | 26 (26, 0) |
| Field accuracy, all fields | 107/156 (68.6%) | 139/156 (89.1%) | 141/156 (90.4%) | 138/156 (88.5%) | 143/156 (91.7%) | 152/156 (97.4%) |
| Field accuracy, text documents | 97/132 (73.5%) | 122/132 (92.4%) | 125/132 (94.7%) | 123/132 (93.2%) | 128/132 (97.0%) | 128/132 (97.0%) |
| Nulls where the document states no value | 10/15 (66.7%) | 14/15 (93.3%) | 13/15 (86.7%) | 10/15 (66.7%) | 13/15 (86.7%) | 15/15 (100.0%) |
| Hallucinated values | 5 | 1 | 2 | 5 | 2 | 0 |
| Missed values (null where stated) | 29 | 6 | 5 | 1 | 2 | 2 |
| Stated fields whose guess is correct, ignoring p_null | 119/141 (84.4%) | 88/141 (62.4%) | 91/141 (64.5%) | 90/141 (63.8%) | 90/141 (63.8%) | — |
| Dates answered with the reference date (2026-10-31) when the document's date differs | 6 | 0 | 1 | 4 | 1 | 0 |
| p_null Brier score (lower is better) | 0.165 | 0.043 | 0.044 | 0.043 | 0.030 | — |
| Latency per document mean / p50 / p95 / max (ms) | 201 / 174 / 274 / 798 | 735 / 564 / 2277 / 2349 | 566 / 538 / 716 / 804 | 672 / 634 / 867 / 2323 | 577 / 517 / 765 / 1627 | 7417 / 4634 / 6646 / 76447 |
| Cost per document (mean) | $0.000320 | $0.000273 | $0.000280 | $0.000341 | $0.000303 | $0.009853 |
| Cost, all documents | $0.008325 | $0.007103 | $0.007288 | $0.008862 | $0.007880 | $0.256173 |

### Accuracy by field

Accuracy counts correct values and correct nulls. Stated: correct values where the document states the field. Not stated: nulls where it does not. Guess: correct guesses where the document states the field, whatever `p_null` says.

| Field | Model | Accuracy | Stated | Not stated | Guess | Wrong | Missed | Hallucinated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| date | clairic | 20/26 (76.9%) | 19/21 (90.5%) | 1/5 (20.0%) | 19/21 (90.5%) | 2 | 0 | 4 |
| date | clairic-tuned | 22/26 (84.6%) | 17/21 (81.0%) | 5/5 (100.0%) | 17/21 (81.0%) | 3 | 1 | 0 |
| date | clairic-tuned-dated | 24/26 (92.3%) | 20/21 (95.2%) | 4/5 (80.0%) | 20/21 (95.2%) | 1 | 0 | 1 |
| date | clairic-tuned-notes | 21/26 (80.8%) | 20/21 (95.2%) | 1/5 (20.0%) | 20/21 (95.2%) | 1 | 0 | 4 |
| date | clairic-tuned-fields | 25/26 (96.2%) | 21/21 (100.0%) | 4/5 (80.0%) | 21/21 (100.0%) | 0 | 0 | 1 |
| date | gemini-flash | 23/26 (88.5%) | 18/21 (85.7%) | 5/5 (100.0%) | — | 1 | 2 | 0 |
| total | clairic | 26/26 (100.0%) | 24/24 (100.0%) | 2/2 (100.0%) | 24/24 (100.0%) | 0 | 0 | 0 |
| total | clairic-tuned | 25/26 (96.2%) | 23/24 (95.8%) | 2/2 (100.0%) | 24/24 (100.0%) | 0 | 1 | 0 |
| total | clairic-tuned-dated | 25/26 (96.2%) | 23/24 (95.8%) | 2/2 (100.0%) | 24/24 (100.0%) | 0 | 1 | 0 |
| total | clairic-tuned-notes | 26/26 (100.0%) | 24/24 (100.0%) | 2/2 (100.0%) | 24/24 (100.0%) | 0 | 0 | 0 |
| total | clairic-tuned-fields | 26/26 (100.0%) | 24/24 (100.0%) | 2/2 (100.0%) | 24/24 (100.0%) | 0 | 0 | 0 |
| total | gemini-flash | 26/26 (100.0%) | 24/24 (100.0%) | 2/2 (100.0%) | — | 0 | 0 | 0 |
| currency | clairic | 9/26 (34.6%) | 6/23 (26.1%) | 3/3 (100.0%) | 19/23 (82.6%) | 0 | 17 | 0 |
| currency | clairic-tuned | 24/26 (92.3%) | 21/23 (91.3%) | 3/3 (100.0%) | 3/23 (13.0%) | 0 | 2 | 0 |
| currency | clairic-tuned-dated | 24/26 (92.3%) | 21/23 (91.3%) | 3/3 (100.0%) | 3/23 (13.0%) | 0 | 2 | 0 |
| currency | clairic-tuned-notes | 25/26 (96.2%) | 22/23 (95.7%) | 3/3 (100.0%) | 3/23 (13.0%) | 0 | 1 | 0 |
| currency | clairic-tuned-fields | 24/26 (92.3%) | 21/23 (91.3%) | 3/3 (100.0%) | 3/23 (13.0%) | 0 | 2 | 0 |
| currency | gemini-flash | 26/26 (100.0%) | 23/23 (100.0%) | 3/3 (100.0%) | — | 0 | 0 | 0 |
| supplier | clairic | 17/26 (65.4%) | 17/26 (65.4%) | — | 19/26 (73.1%) | 7 | 2 | 0 |
| supplier | clairic-tuned | 22/26 (84.6%) | 22/26 (84.6%) | — | 23/26 (88.5%) | 3 | 1 | 0 |
| supplier | clairic-tuned-dated | 22/26 (84.6%) | 22/26 (84.6%) | — | 23/26 (88.5%) | 3 | 1 | 0 |
| supplier | clairic-tuned-notes | 22/26 (84.6%) | 22/26 (84.6%) | — | 22/26 (84.6%) | 4 | 0 | 0 |
| supplier | clairic-tuned-fields | 21/26 (80.8%) | 21/26 (80.8%) | — | 21/26 (80.8%) | 5 | 0 | 0 |
| supplier | gemini-flash | 26/26 (100.0%) | 26/26 (100.0%) | — | — | 0 | 0 | 0 |
| document_number | clairic | 17/26 (65.4%) | 13/21 (61.9%) | 4/5 (80.0%) | 18/21 (85.7%) | 1 | 7 | 1 |
| document_number | clairic-tuned | 24/26 (92.3%) | 20/21 (95.2%) | 4/5 (80.0%) | 21/21 (100.0%) | 0 | 1 | 1 |
| document_number | clairic-tuned-dated | 24/26 (92.3%) | 20/21 (95.2%) | 4/5 (80.0%) | 21/21 (100.0%) | 0 | 1 | 1 |
| document_number | clairic-tuned-notes | 25/26 (96.2%) | 21/21 (100.0%) | 4/5 (80.0%) | 21/21 (100.0%) | 0 | 0 | 1 |
| document_number | clairic-tuned-fields | 25/26 (96.2%) | 21/21 (100.0%) | 4/5 (80.0%) | 21/21 (100.0%) | 0 | 0 | 1 |
| document_number | gemini-flash | 26/26 (100.0%) | 21/21 (100.0%) | 5/5 (100.0%) | — | 0 | 0 | 0 |
| description | clairic | 18/26 (69.2%) | 18/26 (69.2%) | — | 20/26 (76.9%) | 5 | 3 | 0 |
| description | clairic-tuned | 22/26 (84.6%) | 22/26 (84.6%) | — | — | 4 | 0 | 0 |
| description | clairic-tuned-dated | 22/26 (84.6%) | 22/26 (84.6%) | — | — | 4 | 0 | 0 |
| description | clairic-tuned-notes | 19/26 (73.1%) | 19/26 (73.1%) | — | — | 7 | 0 | 0 |
| description | clairic-tuned-fields | 22/26 (84.6%) | 22/26 (84.6%) | — | — | 4 | 0 | 0 |
| description | gemini-flash | 25/26 (96.2%) | 25/26 (96.2%) | — | — | 1 | 0 | 0 |

### Confidence thresholds

Accept a non-null value only when its confidence is at least the threshold, over all six fields. Precision is correct values over accepted values; coverage is correct accepted values over all fields the documents state.

| Model | Confidence ≥ | Accepted | Precision | Coverage |
| --- | --- | --- | --- | --- |
| clairic | 0.00 | 117 | 97/117 (82.9%) | 97/141 (68.8%) |
| clairic | 0.50 | 111 | 95/111 (85.6%) | 95/141 (67.4%) |
| clairic | 0.70 | 103 | 90/103 (87.4%) | 90/141 (63.8%) |
| clairic | 0.90 | 88 | 80/88 (90.9%) | 80/141 (56.7%) |
| clairic | 0.99 | 57 | 53/57 (93.0%) | 53/141 (37.6%) |
| clairic-tuned | 0.00 | 91 | 84/91 (92.3%) | 84/141 (59.6%) |
| clairic-tuned | 0.50 | 88 | 83/88 (94.3%) | 83/141 (58.9%) |
| clairic-tuned | 0.70 | 84 | 82/84 (97.6%) | 82/141 (58.2%) |
| clairic-tuned | 0.90 | 77 | 76/77 (98.7%) | 76/141 (53.9%) |
| clairic-tuned | 0.99 | 58 | 57/58 (98.3%) | 57/141 (40.4%) |
| clairic-tuned-dated | 0.00 | 93 | 87/93 (93.5%) | 87/141 (61.7%) |
| clairic-tuned-dated | 0.50 | 90 | 85/90 (94.4%) | 85/141 (60.3%) |
| clairic-tuned-dated | 0.70 | 86 | 83/86 (96.5%) | 83/141 (58.9%) |
| clairic-tuned-dated | 0.90 | 77 | 75/77 (97.4%) | 75/141 (53.2%) |
| clairic-tuned-dated | 0.99 | 55 | 53/55 (96.4%) | 53/141 (37.6%) |
| clairic-tuned-notes | 0.00 | 100 | 90/100 (90.0%) | 90/141 (63.8%) |
| clairic-tuned-notes | 0.50 | 99 | 89/99 (89.9%) | 89/141 (63.1%) |
| clairic-tuned-notes | 0.70 | 91 | 84/91 (92.3%) | 84/141 (59.6%) |
| clairic-tuned-notes | 0.90 | 79 | 74/79 (93.7%) | 74/141 (52.5%) |
| clairic-tuned-notes | 0.99 | 57 | 53/57 (93.0%) | 53/141 (37.6%) |
| clairic-tuned-fields | 0.00 | 96 | 89/96 (92.7%) | 89/141 (63.1%) |
| clairic-tuned-fields | 0.50 | 92 | 87/92 (94.6%) | 87/141 (61.7%) |
| clairic-tuned-fields | 0.70 | 87 | 83/87 (95.4%) | 83/141 (58.9%) |
| clairic-tuned-fields | 0.90 | 77 | 75/77 (97.4%) | 75/141 (53.2%) |
| clairic-tuned-fields | 0.99 | 55 | 53/55 (96.4%) | 53/141 (37.6%) |

### Totals checked against items

Code adds the item amounts and charges and subtracts the discounts the model read, then compares the sum with the model's total.

| Metric | clairic | clairic-tuned | clairic-tuned-dated | clairic-tuned-notes | clairic-tuned-fields | gemini-flash |
| --- | --- | --- | --- | --- | --- | --- |
| Item amounts exact, itemized documents | 18/21 (85.7%) | 18/21 (85.7%) | 18/21 (85.7%) | 18/21 (85.7%) | 18/21 (85.7%) | — |
| Totals verified by items | 16/26 (61.5%) | 16/26 (61.5%) | 16/26 (61.5%) | 16/26 (61.5%) | 16/26 (61.5%) | — |
| Verified totals that are correct | 16/16 (100.0%) | 16/16 (100.0%) | 16/16 (100.0%) | 16/16 (100.0%) | 16/16 (100.0%) | — |
| Unverified totals that are correct | 8/8 (100.0%) | 7/8 (87.5%) | 7/8 (87.5%) | 8/8 (100.0%) | 8/8 (100.0%) | — |

### Spans

| Metric | clairic | clairic-tuned | clairic-tuned-dated | clairic-tuned-notes | clairic-tuned-fields | gemini-flash |
| --- | --- | --- | --- | --- | --- | --- |
| Text spans covering exactly the guess | 90/90 (100.0%) | 46/46 (100.0%) | 46/46 (100.0%) | 46/46 (100.0%) | 46/46 (100.0%) | — |
| Number, date and item spans within the text | none returned | none returned | none returned | none returned | none returned | — |
| Spans on image documents | 2 | 2 | 2 | 2 | 2 | — |

### Field accuracy by tag

| Tag | clairic | clairic-tuned | clairic-tuned-dated | clairic-tuned-notes | clairic-tuned-fields | gemini-flash |
| --- | --- | --- | --- | --- | --- | --- |
| distractor_dates | 14/18 (77.8%) | 18/18 (100.0%) | 17/18 (94.4%) | 17/18 (94.4%) | 18/18 (100.0%) | 18/18 (100.0%) |
| email | 33/42 (78.6%) | 39/42 (92.9%) | 39/42 (92.9%) | 37/42 (88.1%) | 41/42 (97.6%) | 42/42 (100.0%) |
| en | 68/96 (70.8%) | 87/96 (90.6%) | 87/96 (90.6%) | 85/96 (88.5%) | 89/96 (92.7%) | 93/96 (96.9%) |
| image | 10/24 (41.7%) | 17/24 (70.8%) | 16/24 (66.7%) | 15/24 (62.5%) | 15/24 (62.5%) | 24/24 (100.0%) |
| invoice | 46/66 (69.7%) | 62/66 (93.9%) | 60/66 (90.9%) | 59/66 (89.4%) | 61/66 (92.4%) | 66/66 (100.0%) |
| messy | 17/24 (70.8%) | 21/24 (87.5%) | 22/24 (91.7%) | 23/24 (95.8%) | 23/24 (95.8%) | 22/24 (91.7%) |
| missing_fields | 37/54 (68.5%) | 47/54 (87.0%) | 47/54 (87.0%) | 46/54 (85.2%) | 48/54 (88.9%) | 51/54 (94.4%) |
| number_format | 24/36 (66.7%) | 32/36 (88.9%) | 34/36 (94.4%) | 34/36 (94.4%) | 34/36 (94.4%) | 35/36 (97.2%) |
| pt | 39/60 (65.0%) | 52/60 (86.7%) | 54/60 (90.0%) | 53/60 (88.3%) | 54/60 (90.0%) | 59/60 (98.3%) |
| receipt | 46/72 (63.9%) | 61/72 (84.7%) | 65/72 (90.3%) | 64/72 (88.9%) | 65/72 (90.3%) | 68/72 (94.4%) |
| yearless_date | 9/12 (75.0%) | 10/12 (83.3%) | 12/12 (100.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 10/12 (83.3%) |

### Misses by document

| Document | clairic | clairic-tuned | clairic-tuned-dated | clairic-tuned-notes | clairic-tuned-fields | gemini-flash |
| --- | --- | --- | --- | --- | --- | --- |
| en-invoice-office-supply | — | — | — | — | — | — |
| en-receipt-coffee | currency missed | — | — | — | — | — |
| en-email-saas-receipt | currency missed, supplier missed | — | — | description wrong | — | — |
| en-utility-bill | currency missed | — | — | — | — | — |
| en-contractor-invoice | supplier wrong, document_number missed | — | — | — | — | — |
| en-email-no-amount | date hallucinated | — | — | date hallucinated, description wrong | — | — |
| en-email-reminder-no-date | currency missed | total missed | total missed | — | — | — |
| en-hotel-folio | date wrong, document_number missed, description missed, line items differ | line items differ | date wrong, line items differ | date wrong, line items differ | line items differ | — |
| en-uk-bookshop | currency missed, description wrong | date wrong, description wrong | description wrong | — | description wrong | — |
| en-order-email | date wrong, currency missed | — | — | description wrong | — | — |
| en-eur-tools-invoice | currency missed, line items differ | line items differ | line items differ | line items differ | line items differ | — |
| en-fuel-ocr | currency missed, supplier missed, document_number hallucinated | supplier missed, document_number hallucinated | supplier missed, document_number hallucinated | document_number hallucinated | document_number hallucinated | date wrong, description wrong |
| en-lunch-no-year | currency missed | date missed | — | — | — | date missed |
| en-membership-no-currency | supplier wrong, document_number missed | — | — | — | — | — |
| pt-nfe-distribuidora | currency missed | — | — | — | — | — |
| pt-cupom-padaria | currency missed, description wrong | date wrong | — | — | — | — |
| pt-fatura-telefone | — | — | — | — | — | — |
| pt-recibo-aluguel | supplier wrong, description missed | — | — | description wrong | supplier wrong | — |
| pt-nota-servico-sem-data | date hallucinated, currency missed, document_number missed | — | — | date hallucinated | — | — |
| pt-email-corrida | document_number missed, description missed, line items differ | document_number missed, line items differ | document_number missed, line items differ | line items differ | line items differ | — |
| pt-mercado-sem-ano | currency missed, document_number missed | date wrong | — | — | — | date missed |
| pt-email-sem-valor | date hallucinated | description wrong | description wrong | date hallucinated | description wrong | — |
| img-en-grocery-receipt | currency missed, supplier wrong, description wrong | currency missed | currency missed | currency missed, supplier wrong, description wrong | currency missed, supplier wrong | — |
| img-pt-farmacia | currency missed, supplier wrong, document_number wrong, description wrong | supplier wrong, description wrong | supplier wrong, description wrong | supplier wrong, description wrong | supplier wrong, description wrong | — |
| img-en-invoice-no-date | date hallucinated, currency missed, supplier wrong | currency missed, supplier wrong | date hallucinated, currency missed, supplier wrong | date hallucinated, supplier wrong | date hallucinated, currency missed, supplier wrong | — |
| img-pt-servico-eletrica | currency missed, supplier wrong, document_number missed, description wrong | supplier wrong, description wrong | supplier wrong, description wrong | supplier wrong, description wrong | supplier wrong, description wrong | — |
<!-- generated:end -->

## Findings

The tuned figures below are for `clairic-tuned-dated` unless they say otherwise.

- **Context closed most of the gap.** Field accuracy rose from 68.6% to 90.4%, and from 73.5% to 94.7% on text documents. Missed values fell from 29 to 5, and hallucinated values from 5 to 2. By field: currency rose from 34.6% to 92.3%, document number from 65.4% to 92.3%, date from 76.9% to 92.3%, supplier from 65.4% to 84.6%, and description from 69.2% to 84.6%.
- **Currency is a fact for code, not a question for the model.** Code read the currency of all 22 text documents correctly, including the three that state none. Asked, Clairic usually found the symbol but returned it as a value on only 6 of 23 documents.
- **Knowing the buyer fixes the supplier on text documents.** Without the buyer, Clairic named the buyer as the supplier on 3 text documents. With it, Clairic named the right supplier on 21 of 22 text documents; the miss is the fuel receipt, where it found "QU1CKST0P FUEL" but returned null. On one image it still named the buyer.
- **Keep the reference date, and say that a missing date is null.** As first asked, 6 dates were the reference date itself: 4 on documents that state no date and 2 on documents that do. With the null instruction and the reference date, 24 of 26 dates were right, against Gemini's 23: every text document without a date came back null, and both year-less dates got the right year. Without the reference date, 22 of 26 were right: year-less dates got the wrong year or none, and two dates were read day for month (`12/10/26` as 2026-10-26, `04/09/2026` on a UK receipt as April 4). The two remaining misses are the hotel folio's arrival date, at confidence 0.50, and the reference date on the image invoice without a date.
- **Scanned images now get answers, but Clairic reads them poorly.** Names come back garbled, such as "ELÉICA LU FOR" for Elétrica Luz Forte and "DIPIONANA5000 0CP" for Dipirona 500mg, and currency was missed on both English images. Clairic read 66.7% of image fields correctly; Gemini read all of them.
- **Descriptions from item names work when the items say what was bought.** 22 of 26 were right. They fail when the item names do not say it, such as book titles, or when the document lists no items, such as an email about an attached invoice, where Clairic listed the supplier's name. Gemini summarizes instead.
- **Totals stay Clairic's strongest field.** Every total that code could verify from the items was correct, 16 of 16 in every request. The tuned requests missed one total: they read the $640.00 balance in a reminder email but returned null.
- **Confident answers on text documents were all right.** Of the answers with confidence at least 0.9, 75 of 77 were correct (97.4%), covering 53.2% of the stated fields. Both mistakes are on the image invoice without a date: the buyer as the supplier and the reference date as the date. These are the fields Clairic answers: date, total, supplier, document number, and currency on images.
- **Book notes: Clairic follows a specific rule, but reads the notes as part of the document.** The notes fixed three of the four misses they addressed, two of them at confidence 1.00: the reminder's total, the ride code as document number, and the fuel station as supplier. The hotel folio still got its arrival date. But words from the notes, such as "Book notes" and "hotel", appeared in the item names of 14 of 26 documents, which broke 5 descriptions; the one description they fixed, the UK bookshop's, matched only because "Book notes" contains "book". Three documents without a date got the reference date again, at confidence 0.98 or more. Overall accuracy fell from 90.4% to 88.5%, hallucinated values rose from 2 to 5, and answers with confidence at least 0.9 fell from 97.4% to 93.7% correct.
- **Field notes: the same rules in each field's question fixed what they addressed, without the damage.** All four misses the notes addressed were fixed, three at confidence 1.00: the hotel folio's date, the reminder's total, the ride code as document number, and the fuel station as supplier. Item lists stayed free of note words, no text document got the reference date, and answers with confidence at least 0.9 stayed 97.4% correct. Text documents reached 97.0% of fields, as Gemini did, and all fields 91.7%. A rule can still hurt its own field: "the business named at the top of a receipt" made Clairic name the payer of the rent receipt, whose name is at the top while the landlord signs at the bottom, at confidence 0.48. The garbled grocery image name also turned wrong. These notes were written for these documents' misses, so matching Gemini here shows that Clairic follows field rules, not that it would match Gemini on new documents.
- **Clairic is much faster and cheaper.** Clairic took a median 538 ms and $0.000280 per document; Gemini took 4,634 ms and $0.009853, about 35 times more. Gemini's cost is mostly reasoning tokens: the fuel receipt alone used 10,008 output tokens and 76.4 s, about $0.111, 43% of Gemini's total.

## Recommendation

**Keep Gemini as Extractor Bot's extraction path for now. Clairic with the bot's context is worth testing on real documents as a first pass for text documents.**

- Gemini was right on 97.4% of all fields (97.0% on text documents) and never hallucinated a value. Its only miss outside dates was the fuel receipt's description, read as "REG UNL". Tuned Clairic was right on 90.4% (94.7% on text documents).
- Missing context, not the model alone, explained most of Clairic's first result. What remains is scanned images, descriptions and a few dates.
- If Extractor Bot moves to Clairic, its learning from corrections (ACE) has to change shape. Free-text instructions in the state helped on the fields they named and hurt everything else; the same rules in each field's question kept the fixes without that damage. So ACE would learn rules per field, and existing instructions, written for Gemini and covering every field, cannot be reused as they are. Because one rule can still break another document in the same field, each learned rule should be checked against several of the Account's recent documents before it is kept, which Clairic's price makes affordable.
- A next step, which needs separate approval: on text documents, run tuned Clairic first, with the day the document arrives as the reference date. Keep its date, total, supplier and document number when each has confidence at least 0.9 and the items verify the total; take the currency from code; and call Gemini for anything missing and for every image. If Gemini must still write every description, Clairic saves nothing, so the trial should also show whether descriptions from item names are good enough. Measure it on real, consented documents before relying on it, because these instructions were tuned on this test set.

Limits: 26 synthetic documents written and labelled by one author, one run per request, and small counts. The tuned requests and the Book notes were written after seeing earlier misses, on the same documents. Field matching is lenient for supplier and description, which favours neither model's wording in particular but does reward Gemini's summaries over Clairic's copied lines. Gemini's properties came from a configured prompt written for this trial; Books without one get only date, amount and description. The buyer's name assumes the Book's name or a property gives it.

## Reproduce

```bash
bun eval/system-one/run.ts --check    # RESULTS.md matches the recorded responses
bun eval/system-one/run.ts            # print the generated section
# Paid live calls; replace the recorded calls and the generated section:
export BKPER_AI_BASE_URL=https://ai.bkper.app/v1 BKPER_AI_OAUTH_TOKEN=$(bkper auth token)
bun eval/system-one/run.ts --live-clairic   # every Clairic request, keeping Gemini's calls
bun eval/system-one/run.ts --live-new       # only requests with no recorded calls
bun eval/system-one/run.ts --live           # every model
```
