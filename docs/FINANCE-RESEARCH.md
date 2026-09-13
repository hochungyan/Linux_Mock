# Investment-bank and hedge-fund investigation design

Verified online on 12 September 2026. These are original fictional training cases, not leaked interview questions, incidents attributed to employers, or replicas of their internal systems. Role descriptions establish the work being practised; vendor and protocol documentation establishes technical concepts. No single role covers every desk or product.

## What the job requires

- [Citi FX Application Support Senior Analyst](https://jobs.citi.com/job/new-york/application-support-senior-analyst-assistant-vice-president/287/98098154192): the public description includes start-of-day checks, same-day risk reconciliation, regional handovers, Linux/SQL diagnosis and communication with traders. Its advertised closing date has passed; it is evidence of responsibilities, not a claim of an open vacancy.
- [Point72 Trading Application Support](https://careers.point72.com/CSJobDetail?jobCode=PIT-0015230&jobName=it-operations-engineer-trading-application-support&locale=English&location=New+York&retURL=%2FCSCareerSearch): support for front-office applications and trading teams, daily checks, incident coordination, documentation and stakeholder communication.

The design inference is that Linux health checks are supporting evidence. The outcome must also establish that the trading or operational workflow is trustworthy. A clean recovery preserves evidence, identifies affected business scope and verifies orders, positions, book depth or valuations before resuming.

## Four additional playable investigations

| Case | Primary grounding | What the exercise tests |
|---|---|---|
| Execution replay inflates hedge-fund positions | [FIX PossDupFlag](https://fiximate.fixtrading.org/en/FIX.Latest/cds43.html), [FIX session standard](https://www.fixtrading.org/standards/fix-session-layer/) | Correlate execution identity and scope with independent broker evidence. A possible duplicate is not proof of an already-applied fill. Preserve the original ledger, repair only confirmed duplicates and reconcile quantity before resume. |
| Allocation/SSI mismatch prevents affirmation | [DTCC allocation, affirmation and settlement](https://www.dtcc.com/insights/2024/trade-affirmations-key-questions-answered-as-t1-approaches) | Identify reference-data disagreement, validate approved account/SSI changes, retry rejected allocations and establish the resulting business states. Affirmation and settlement are different milestones. |
| Futures book incomplete despite moving prices | [CME MDP 3.0 book recovery](https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457672425) | A gap on both incremental feeds requires book recovery. Reconcile the snapshot checkpoint to retained increments, validate independent depth at a matching sequence and reinstate the validity gate. |
| Successful FX risk job uses stale marks | [LSEG pricing/valuation inputs](https://www.lseg.com/en/data-analytics/market-data/data-analytics-pricing/evaluated-pricing-data), Citi role above | Inspect selected business date and data lineage, retain position identity, use an approved current mark and reconcile the recomputed result before publication. |

The FX figures, sequence numbers, counterparty identities, quantities, clocks, financial-impact rates and approval IDs are deliberately invented fixtures. The FX case models net currency exposure times a conversion rate; it is not a complete P&L or VaR calculation. The book case uses a tiny decoded quantity model; it does not implement CME SBE messages, every recovery rule, or order matching. Follow the relevant product's full protocol in real systems.

## Investigation workflow and limits

Each new case provides a pager, a virtual filesystem, diagnostic logs/CSV evidence, plausible alternate causes, progressive hints, a scoped runbook and an interview debrief. Restarts do not repair incorrect business data. Repeated recovery actions must not double-book quantities or resubmit already-accepted allocations. Release remains blocked until the simulated business checks pass.

Localhost admin endpoints are fictional controls representing firm-specific tooling and approved escalation workflows. They operate solely on in-memory game state. They neither transmit real orders nor invoke vendors, production services or databases. New cases use exact endpoint matching and explicit POST for state changes; older scenario endpoints retain their existing scoped behavior.

Testing checks command execution and resulting business-state invariants, rejected prerequisites, idempotent retries, evidence availability, restart consequences and browser completion. Passing tests establishes fixture consistency; it cannot prove a full Linux emulator or universal interview coverage.
