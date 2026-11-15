# Plan: substantially improve account discovery

A long-running plan. Update the status and the goal after each step; delete this file when the work is done.

## Where we are

Measured on 26,193 real bank transactions from 14 Books, each guessed using only the history before it:

- 71% right, 4% wrong, 25% no guess; about 5% of suggestions are wrong.

Why the other 29% miss, as a share of all cases:

| Where the right account was | Share | What can fix it |
| --- | --- | --- |
| Found, but Jev was not sure enough to pick it | 9% | Choosing better: learning from users' decisions |
| Found by a different search than the one that decided | 3% | Fuzzy search as the main search, or combining searches |
| No past description resembles the new one | 13% | Fuzzy search as the last step |
| Past descriptions point only to other accounts | 4% | Not from history |

## Ceiling and goal

- **Ceiling: about 92% right.** The right account is reachable from history in about 92% of cases: today's 71%, the 9% and the 3%, and the 73% of the 13% where fuzzy search finds it among the 15 closest past transactions.
- **First goal: about 80% right, with at most about 5% of suggestions wrong.** Reachable is not decidable: the same description often went to different accounts, and nothing in the draft tells which. In doubt, Bookbot stays silent.
- Revise the goal after each step, from that step's measured gain.

## Rules throughout

- Accuracy first: no suggestion is better than a wrong one.
- One change at a time. Each is tested offline on real Books against a target written before running, and confirmed once on cases never used to develop it.
- The gain must show across most Books, not come from one.
- A step that misses its target is not forced through; its lesson is recorded.
- Client data stays in the private evaluation folder; this repository holds only code and totals.

## Steps

### 0. Keep the proof machinery (ongoing)

- Offline evaluation on frozen real cases: the reference for every change.
- Production check on or after 2026-11-28: do users change fewer suggestions since the deploy of 2026-11-14? Target fixed in the private evaluation folder.
- Refresh the cases every few weeks, so confirmations use new data.

### 1. Choose better when Bookbot hesitates (the 9%)

- Problem: the right account was among the options, but Jev was unsure or chose another.
- Approach: learn from users' decisions. A description of each contra-account, learned from what users post there and sharpened by every case where Bookbot hesitated or was wrong, so Jev knows what each option is for.
- Why first: the largest fixable group, with no new infrastructure.
- Possible gain: up to about 4 points.
- First test, plain descriptions written from each account's history: target not met. On 120 hesitations, 7 more right with no more wrong; on 60 cases right today, 5 fewer right, because Jev became less sure.
- Ambiguity check, on 1,133 hesitations: in 62% nothing in the history tells the options apart; in 15% the history points to another account; in 20% a signal points to the right one. The right account is the most recently used in only 27% of the ambiguous cases: these are mostly exceptions only the user can decide.
- Status: open. Most of the 9% cannot be decided from history.

### 2. Find history when the words differ (the 13%)

- Problem: the same operation is written differently, so the exact-word search finds nothing.
- Approach: fuzzy search over past transactions as the last step, trusted only on close matches.
- Evidence: on 200 cases, close matches (at least 50% alike) gave suggestions 95% right on a third of the cases; all matches gave 84% right, below the 90% target. The close-match rule was chosen after seeing that result, so it still needs a fresh test and a confirmation.
- Also needed: a lightweight way to search past transactions in production.
- Possible gain: about 4 points.
- Status: rule to confirm.

### 3. Make fuzzy the main search (the 3%, part of the 4%)

- Problem: Bookbot trusts the first search that finds anything, even when a better match exists.
- Approach: rank all past transactions by similarity in one pass instead of trying searches one by one.
- Evidence: on cases right today, the right account was among the 15 closest in all of them, and the closest was right 96% of the time.
- Possible gain: about 1–2 points, and a simpler search.
- Status: after step 2.

### 4. Beyond history (what history cannot reach)

- Problem: nothing in the past leads to the right account.
- Approach: instead of guessing, offer the user the top 2–3 candidates; use outside signals when available, such as the document or counterpart IDs from the bank.
- Gain: less work for the user rather than more automatic accuracy.
- Status: later.

## Tried and set aside

- Different facts for Jev, with "most used" as the last tie-breaker: more wrong suggestions; reverted.
- Choosing from the whole chart of accounts with names and groups only: rarely confident, and Jev accepts at most 255 options.
- The account's name written in the description: present in 2% of misses, and reliable only in some Books.
- The last same description wins, as a separate memory: about 2.5% more right; posted history already acts as that memory.
