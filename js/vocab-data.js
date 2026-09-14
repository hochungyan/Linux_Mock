/* vocab-data.js - product, market and FIX vocabulary for the reference track.
 *
 * Data only; js/vocab.js renders it. Four block kinds:
 *   terms(...)  rows are [term, what it is, why production support cares]
 *   table(...)  a column header list plus rows of the same width
 *   sample(...) rows are [label, literal text block, what to notice]
 *   drill(...)  rows are [interview question, answer you should be able to give]
 *
 * Strings are double quoted throughout this file so plain ASCII apostrophes can
 * be used in the prose.
 */
var PS = window.PS || (window.PS = {});

(function (PS) {
  "use strict";

  PS.vocabSections = [];

  function section(id, title, kicker, blocks, sources) {
    PS.vocabSections.push({ id: id, title: title, kicker: kicker, blocks: blocks, sources: sources || [] });
  }
  function terms(heading, note, rows) { return { kind: "terms", heading: heading, note: note, rows: rows }; }
  function table(heading, note, columns, rows) { return { kind: "table", heading: heading, note: note, columns: columns, rows: rows }; }
  function sample(heading, note, rows) { return { kind: "sample", heading: heading, note: note, rows: rows }; }
  function drill(heading, note, rows) { return { kind: "drill", heading: heading, note: note, rows: rows }; }

  /* ------------------------------------------------------------------ */
  section("desk", "The desk map",
    "Who trades what, who books it, and which of them pages you at 07:00",
    [
      terms("Sides of the market", "Interviewers open here to find out whether you know whose problem you are fixing.", [
        ["Sell side", "Investment banks and brokers. They make markets, execute client orders, warehouse risk and provide financing.", "Sell-side support owns client connectivity: FIX sessions, order gateways, drop copies, client reports. An outage is visible to external clients within seconds."],
        ["Buy side", "Asset managers, pension funds and hedge funds. They take positions and send orders out to brokers and venues.", "Buy-side support owns the OMS/EMS, the position and PnL books, broker connectivity and the daily NAV and recon chain. An outage is visible to portfolio managers and the fund administrator, not to external clients."],
        ["FICC", "Fixed Income, Currencies and Commodities. Rates, credit, FX, commodities and their derivatives, cash and OTC.", "Most FICC flow is OTC and bilateral, so incidents cluster on pricing inputs (curves, fixings, vol), booking and confirmation, and settlement - not only on exchange gateways."],
        ["Equities", "Cash shares, ETFs and the listed and OTC derivatives written on them.", "Equities is exchange-centric and latency-sensitive: market data feed handlers, order routers, exchange sessions, corporate actions and stock borrow."],
        ["Delta One", "Desk trading instruments whose value moves close to one-for-one with the underlying: index futures, ETFs, total return swaps, certificates.", "Delta One joins equity, financing and swap plumbing, so one break usually crosses three books. Expect swap reset, dividend and financing-accrual incidents."],
        ["Flow vs exotics", "Flow is high-volume standardised business. Exotics is low-volume bespoke structures priced with models.", "Flow breaks loudly and by volume; exotics break quietly and by value. A single unpriced exotic trade can dominate a desk PnL explain."],
        ["Market maker", "A participant quoting two-way prices and taking the other side of client trades, earning spread and managing the residual risk.", "Market makers have quoting obligations. A stale price feed does not only lose money, it can breach an exchange market-making obligation."],
        ["Agency vs principal", "Agency: the broker executes for the client and takes no position. Principal: the firm trades against its own book and holds the risk.", "Capacity is a booked field (FIX tag 528) and drives regulatory reporting, commission and risk. A wrong capacity is a reportable data break, not cosmetic."],
        ["Prime broker", "A bank providing hedge funds with clearing, financing, stock borrow, custody and consolidated reporting.", "PB files (positions, margin, activity, financing) arrive on a nightly schedule. A late or partial PB file stops a hedge fund start of day."],
        ["Execution vs clearing broker", "The execution broker gets the fill; the clearing broker carries the trade to the CCP and holds the margin.", "Give-up flows mean the firm on your FIX session is not necessarily the firm in the clearing file. Recon breaks often live exactly here."]
      ]),
      table("Asset class map - the version you can draw on a whiteboard", "",
        ["Asset class", "Products you will hear named", "Systems support touches", "Classic production failure"],
        [
          ["Cash equities", "Ordinary shares, ADR/GDR, ETFs", "Market data handlers, smart order router, exchange FIX sessions, security master", "Corporate action unapplied; stale reference data; venue session down at the open"],
          ["Equity derivatives", "Listed options and futures, OTC options, TRS, CFDs, variance and dividend swaps, autocallables", "Pricing library, vol surface publication, swap reset engine, lifecycle and expiry batch", "Vol surface not published so options price at zero or fail; expiry not processed"],
          ["Rates", "Government and corporate bonds, IRS, OIS, FRA, swaptions, bond and STIR futures", "Curve builder, fixings loader, valuation batch, CCP margin interface", "Fixing missing or curve fails to build, so the swap book cannot revalue"],
          ["Credit", "CDS single name, CDX and iTraxx indices, credit bonds", "Spread marking, credit curve build, index roll processing", "Index roll not applied; credit event or recovery not lifecycled"],
          ["FX", "Spot, forwards, NDFs, FX swaps, FX options, cross-currency swaps", "Rate feed and fixings, netting and CLS interface, settlement instructions", "Missed value-date cutoff; fixing not published; prior-day rate silently reused"],
          ["Commodities", "Futures on energy, metals and agriculture; physical contracts; commodity swaps", "Exchange sessions, roll and expiry batch, warehouse and physical inventory", "Roll or first notice day missed; contract specification changed and not loaded"],
          ["Financing", "Repo, reverse repo, stock borrow and loan, margin lending", "Collateral engine, tri-party interface, margin call workflow", "Margin call file late; collateral eligibility or haircut data stale"]
        ]),
      drill("Say it in one sentence", "", [
        ["What does FICC actually contain?", "Fixed income (government and corporate bonds, rates derivatives), currencies (FX spot, forwards, swaps and options) and commodities (energy, metals, agriculture), cash and derivative, traded mostly over the counter rather than on an exchange."],
        ["Why do support engineers care about agency versus principal?", "It changes who holds the risk, which book the trade lands in, what capacity is stamped on the execution and the regulatory report (FIX tag 528), and how commission and settlement legs are built. A wrong capacity is a reportable break."],
        ["Bank support versus hedge fund support - what is different day to day?", "A bank desk supports external client connectivity and market-making obligations, so incidents are client-visible immediately. A fund supports the internal investment chain - broker connectivity, OMS, positions, risk, NAV and recon - where the incident is measured against a start-of-day or NAV deadline."]
      ])
    ],
    [["ISDA - product definitions and market practice", "https://www.isda.org/"],
     ["FIX Trading Community", "https://www.fixtrading.org/"]]);

  /* ------------------------------------------------------------------ */
  section("lifecycle", "Trade lifecycle end to end",
    "Order to settlement, and the handover points where things actually break",
    [
      terms("The chain", "If you can narrate this chain, you can locate almost any incident in it.", [
        ["Order", "An instruction to buy or sell: instrument, side, quantity, order type, price limit, time in force, account.", "An order that leaves the OMS but never reaches the venue is the most common escalation. Prove which hop dropped it using the order id at each stage."],
        ["Execution (fill)", "All or part of an order traded at a price, reported as an ExecutionReport carrying an execution id.", "Fills drive positions, risk and settlement. Duplicate or missed fills corrupt all three, so deduplicate on the execution id, never on quantity."],
        ["Allocation", "Splitting a block execution across the underlying client accounts or funds.", "Allocation failures leave the block booked and the accounts empty: the trade looks right on the desk and wrong in the fund books."],
        ["Confirmation / affirmation", "The two sides exchange and agree the economic terms. Affirmation is the counterparty agreeing to the confirmation.", "Unaffirmed trades miss the settlement cutoff, and standing settlement instruction data is the usual root cause."],
        ["Clearing", "A central counterparty steps between buyer and seller (novation) and becomes the counterparty to both.", "Clearing interfaces are file and message based with hard daily cutoffs. A missed cutoff has margin and regulatory consequences, not just a retry."],
        ["Settlement", "Exchange of securities for cash on settlement date, normally delivery versus payment (DvP).", "A settlement fail costs money: buy-in risk, CSDR penalties, interest claims. This is rarely a 'we will rerun tomorrow' failure."],
        ["Custody", "Holding securities on behalf of the owner at a custodian or central securities depository.", "The custodian statement is the external truth your position records are reconciled against."],
        ["Nostro / vostro", "Nostro: our cash account held at another bank. Vostro: their account held with us.", "Cash reconciliation compares your ledger to the nostro statement (SWIFT MT940/MT950). A missing statement looks exactly like a thousand cash breaks."],
        ["Reconciliation", "Comparing two independent records - internal versus custodian, internal versus broker, book versus feed - and investigating the differences.", "'Recon break' is the most common post-trade ticket title. Always ask which two sources, as of what time, in which currency and quantity units."],
        ["Break / exception", "A difference reconciliation could not match automatically.", "One-sided breaks in bulk almost always mean a missing file or a changed mapping, not a thousand wrong trades."],
        ["STP (straight-through processing)", "A trade flowing from execution to settlement with no manual intervention.", "Support keeps the STP rate high. Every manual repair should end with a question about why STP failed."],
        ["T+1 / T+2", "Settlement convention: trade date plus one or two business days. US, Canadian and Mexican equities moved to T+1 in May 2024; EU and UK equities are T+2; most FX spot is T+2.", "T+1 compresses affirmation and funding into trade date evening. Batch jobs that used to have overnight slack no longer do."],
        ["SSI (standing settlement instruction)", "Stored account and custodian details used to settle with a counterparty in a given currency or market.", "Stale or missing SSIs are a leading cause of affirmation and settlement failures, and the fix is reference data, not the trade."],
        ["Golden source", "The system designated authoritative for a data set (security master, positions, prices).", "Name the golden source before repairing anything. Repairing a downstream copy creates a second, confidently wrong, truth."]
      ]),
      terms("The day, in order", "Interviewers love 'walk me through your day' - this is the skeleton.", [
        ["Start of day (SOD)", "Overnight batch complete, positions rolled, static and reference data loaded, prices seeded, sessions logged on before the open.", "SOD checks are the highest-value monitoring you own: sessions up, positions rolled, feeds ticking, reference data current."],
        ["Intraday", "Trading, risk updates, intraday recon, exception queues, client queries.", "Intraday incidents are mostly connectivity, latency, capacity, or a reference-data change deployed into a live session."],
        ["End of day (EOD)", "Final marks, valuation, PnL, risk run, position keeping, regulatory reporting, file deliveries.", "EOD is a dependency chain with a hard deadline. Know the critical path and which job must not slip."],
        ["Overnight batch", "Revaluation, accruals, corporate action application, fee calculation, reporting extracts, archive.", "A batch that finished successfully is not proof of a correct business result. Check positions, PnL and file row counts, not only the exit code."],
        ["Cutoff", "A contractual or market deadline: venue close, CLS cutoff, CCP margin call, reporting deadline, NAV deadline.", "Escalate against the cutoff, not the error. 'The job failed' is not an incident description; 'we will miss the 16:00 margin call' is."]
      ]),
      drill("Say it in one sentence", "", [
        ["Walk me through the life of an equity trade.", "An order enters the OMS, is routed over FIX to a broker or venue, executes and returns execution reports, the block is allocated across accounts, confirmed and affirmed with the counterparty, cleared through a CCP or bilaterally, settled DvP at the CSD or custodian on T+1 or T+2, then reconciled against custodian and broker records and reported to regulators."],
        ["A PM says a position is wrong. Where do you start?", "Establish which system is authoritative, then rebuild the position from its inputs: start-of-day position, plus today's fills, plus lifecycle events (corporate action, expiry, assignment, swap reset), minus allocations. The difference tells you whether it is a missing fill, a duplicate, an unapplied corporate action or a bad SOD roll."],
        ["Why does T+1 change support work?", "Affirmation, funding and FX must complete on trade date evening instead of the next morning, so the overnight window shrank. Jobs that previously had recoverable slack now sit directly on a cutoff, and manual repair time has to be replaced by monitoring and automation."]
      ])
    ],
    [["DTCC - accelerated settlement", "https://www.dtcc.com/"],
     ["SWIFT standards (MT and MX messages)", "https://www.swift.com/standards"]]);

  /* ------------------------------------------------------------------ */
  section("equities", "Cash equities and corporate actions",
    "Shares, ETFs, borrow, and the events that silently change a position overnight",
    [
      terms("Cash equity vocabulary", "", [
        ["Ordinary share / common stock", "A unit of ownership in a company, carrying a claim on residual profits and normally a vote.", "The instrument identity behind every equity incident: symbol, exchange, currency, ISIN. Most 'wrong price' tickets are the wrong line in the security master."],
        ["ADR / GDR", "A depositary receipt traded in one market representing shares held in another (American / Global).", "An ADR has its own identifier, its own ratio to the underlying share, and its own corporate action treatment and fees. Never treat it as the local line."],
        ["ETF", "A fund whose units trade like a share and track an index, a basket or a commodity.", "ETFs have a creation/redemption process with authorised participants, plus NAV and iNAV feeds. Support sees basket file, NAV publication and index-data failures."],
        ["Primary vs secondary market", "Primary: securities issued by the company (IPO, rights issue). Secondary: investors trading with each other.", "Primary events (IPO, rights) require instrument setup before trading starts. 'Unknown symbol' rejects at the open usually trace back here."],
        ["Lit venue / dark pool / SI", "Lit: a public order book. Dark: no pre-trade transparency. Systematic internaliser: a firm executing client orders against its own book.", "Venue type drives reporting obligations and the LastMkt (tag 30) you see on fills. Surveillance and best-execution reporting depend on it."],
        ["Auction (open / close)", "A single-price matching event at the start and end of the session where a large share of daily volume prints.", "Auctions are the highest-consequence minutes of the day. A gateway problem at 16:29 is not equivalent to one at 13:00."],
        ["Short sale", "Selling a security you do not own, having first arranged to borrow it.", "Short marking (FIX Side 5 or 6) is a regulatory field. Mismarking a sale is a reportable compliance issue, and a failed locate can mean a naked short."],
        ["Locate / borrow", "Locate: evidence that stock can be borrowed before shorting. Borrow: the actual stock loan, with a fee and recall risk.", "Stock loan recalls and rate changes arrive as files. Missing borrow data blocks short orders at the risk check, which support sees as 'my order was rejected'."],
        ["Settlement fail", "Failing to deliver securities or cash on settlement date.", "Fails generate penalties and buy-ins, and they cascade: your failed receipt causes your onward failed delivery."]
      ]),
      terms("Corporate actions - the ones you will be asked about", "Corporate actions change quantity, price or cash without any trade. That is why they surprise position support.", [
        ["Cash dividend", "The issuer pays cash per share to holders on the record date.", "Dividend accruals, withholding tax rates and swap/CFD dividend pass-throughs all break here. A missing dividend shows as a cash break, not a position break."],
        ["Stock split / reverse split", "Share count multiplied (or divided) with price divided (or multiplied) so the market value is unchanged.", "If quantity is not adjusted but the price feed is, the book value halves overnight. Never fix that by overriding the price - the price is correct, the quantity is stale."],
        ["Rights issue", "Existing holders receive rights to buy new shares at a discount; rights may themselves trade.", "New temporary instruments must be set up and lapsed. Unexercised rights expiring worthless is a real PnL event."],
        ["Merger / takeover", "Shares are exchanged for cash, other shares, or a mix.", "The old line must stop trading and the new entitlement must be booked. Orders on a delisted line reject with 'unknown symbol'."],
        ["Spin-off / demerger", "Part of a company is distributed to holders as a separate listed company.", "Creates a new position out of nothing in your books. Cost-basis allocation between the lines is an accounting decision, not a support one."],
        ["Ex-date / record date / pay date", "Ex-date: trade from here without the entitlement. Record date: holders on the books are entitled. Pay date: cash or stock delivered.", "Entitlement is decided by the trade's settlement relative to the record date - which is why unsettled trades produce claims between counterparties."],
        ["Mandatory vs voluntary", "Mandatory events apply automatically; voluntary events need an election by a deadline.", "Voluntary events have a response deadline. A missed election deadline is a client-money-losing event with no technical rollback."],
        ["Claim / market claim", "A compensating payment when the entitlement went to the wrong side because the trade was not settled at record date.", "Explains cash breaks that are nobody's coding error: they are the normal consequence of a settlement fail across a record date."]
      ]),
      drill("Say it in one sentence", "", [
        ["The book halved overnight with no trades. What happened?", "Almost certainly a share split where the price feed applied the adjustment and the position did not. Confirm the corporate action and ex-date in the security master and the vendor notification, then apply the quantity adjustment - the vendor price is correct and the quantity is stale, so overriding the mark would be the wrong fix."],
        ["Why is short-sale marking a support concern?", "Side 5 (sell short) and 6 (sell short exempt) are regulatory markers carried on the order and the regulatory report. If a mapping or default sends a short as a plain sell (Side 2), you have created a reporting and compliance break, not a display problem."],
        ["A client says their dividend is missing. What do you check?", "The corporate action record (ex-date, record date, pay date, rate and currency), whether the position on record date was correct and settled, the withholding tax treatment, and for swaps and CFDs whether the dividend pass-through leg was generated. Then check whether the cash actually arrived on the nostro."]
      ])
    ],
    [["London Stock Exchange - corporate actions", "https://www.londonstockexchange.com/"],
     ["ESMA - short selling regulation", "https://www.esma.europa.eu/"]]);

  /* ------------------------------------------------------------------ */
  section("eqd", "Equity derivatives",
    "Options, futures, swaps and structured payoffs written on equity underlyings",
    [
      terms("The product set", "", [
        ["Equity derivative", "A contract whose value is derived from a share, a basket, an index or a dividend stream rather than from owning it.", "You are supporting a valuation chain, not just a trade record: underlying price, volatility surface, dividends, borrow cost and the discount curve all have to arrive before the book can be marked."],
        ["Listed option", "An exchange-traded, standardised call or put with fixed strikes and expiries, cleared by a CCP.", "Exchange contract specifications change (strike intervals, adjustments after corporate actions). A specification file not loaded shows up as unknown-symbol rejects."],
        ["OTC option", "A bilaterally negotiated option with any strike, expiry and payoff the two sides agree.", "No exchange to reconcile against, so the confirmation and the internal booking are the only records. Booking errors are found by confirmation mismatch, not by a reject."],
        ["Index future", "A standardised exchange contract on an index level, cash settled, with a contract multiplier.", "The most common Delta One hedging instrument. Roll dates, multipliers and settlement prices are reference data with hard dates."],
        ["Single stock future", "A future on one share, cash or physically settled depending on the venue.", "Corporate action adjustments apply to the contract terms, not only the underlying."],
        ["Total return swap (TRS)", "One side pays the total return (price change plus dividends) of an asset, the other pays a financing rate plus a spread.", "A TRS generates periodic resets, dividend pass-through legs and financing accruals. Most TRS incidents are missed resets or a missing dividend, not pricing."],
        ["CFD (contract for difference)", "A cash-settled bilateral contract paying the price difference of an underlying, with financing charged on the notional.", "Same failure surface as a TRS: financing accrual, dividend adjustment and margin."],
        ["Equity swap reset", "The scheduled recalculation of the swap legs against the new underlying level and financing rate.", "A missed reset leaves the swap valued against a stale level, which looks like a large unexplained PnL move on an untraded position."],
        ["Variance / volatility swap", "A swap paying the difference between realised variance (or volatility) and a strike agreed at inception.", "Needs a clean daily closing price series. One bad or missing close corrupts the realised variance calculation for the whole life of the trade."],
        ["Dividend swap / future", "A contract on the actual dividends paid by an index or share over a period.", "Values depend on the dividend forecast data set - a reference-data feed, not a price feed."],
        ["Warrant", "A long-dated option-like security issued by a company or a bank and traded as a listed line.", "Behaves like a security for settlement and like an option for valuation, so it appears in both chains."],
        ["Convertible bond", "A bond that can be converted into a fixed number of shares, so it carries credit, rates and equity optionality at once.", "Needs bond static, credit spread, equity price, borrow and vol at the same time. Convertibles fail to price when any one of five inputs is missing."],
        ["Autocallable / structured note", "A structured payoff that redeems early if the underlying is above a barrier on an observation date, otherwise continues, often with a capital barrier at maturity.", "Observation dates are scheduled events. A missed observation is a lifecycle failure that changes whether the note has already redeemed."],
        ["Barrier option", "An option that is knocked in or knocked out when the underlying touches a level.", "Barrier monitoring uses intraday prices. A market data gap around the barrier is a genuine valuation dispute, not a nuisance."],
        ["Basket / index swap", "One contract referencing a weighted basket of names, rebalanced on a schedule.", "Rebalance files drive the basket composition. A missing rebalance quietly prices yesterday's basket."]
      ]),
      terms("Inputs the book cannot be marked without", "When an equity derivative book fails to value, it is almost always one of these five.", [
        ["Underlying price / close", "The official price for the underlying used for marking and for lifecycle observations.", "Check the official close, not the last trade you can see. Desks mark to a defined source and time."],
        ["Volatility surface", "Implied volatility by strike and expiry, built from listed option prices and interpolation.", "If surface publication fails, options price at nonsense or fail outright. This is the number one equity derivative production incident."],
        ["Dividend forecast", "Expected future dividends for the underlying over the life of the trade.", "Wrong dividends move forward prices and therefore option values with no market move at all."],
        ["Borrow / repo rate on the stock", "The cost of borrowing the underlying, which affects the forward price.", "A hard-to-borrow name repricing is a real move. Support's job is to prove whether the rate changed or the feed broke."],
        ["Discount curve", "The interest rate curve used to discount future cash flows, typically an OIS or CSA-based curve.", "If the curve build fails, the entire book fails to value, not only derivatives."]
      ]),
      drill("Say it in one sentence", "", [
        ["Explain a total return swap to a non-trader.", "One side gets the full economic return of an asset - price moves plus dividends - without owning it, and pays a financing rate plus a spread for that exposure. The other side holds or hedges the asset and earns the financing. It is used for synthetic exposure, leverage, and access to markets where direct holding is difficult."],
        ["The equity option book will not revalue this morning. What do you check first?", "The valuation inputs, in dependency order: did the vol surface publish, did the underlying official closes arrive, did the dividend and borrow data load, and did the discount curve build. The valuation engine failing is usually a symptom of an upstream market data or curve job, so check the input timestamps before restarting anything."],
        ["Why is a missed swap reset serious?", "The swap legs stay valued against a stale underlying level and financing rate, so the book shows a large PnL move on a position nobody traded, and the cash flow to the counterparty is calculated wrongly. It is both a PnL explain problem and a payment problem."]
      ])
    ],
    [["Eurex - product specifications", "https://www.eurex.com/"],
     ["Cboe - options product specifications", "https://www.cboe.com/"]]);

  /* ------------------------------------------------------------------ */
  section("fwdfut", "Forwards, futures and the margin machinery",
    "The comparison interviewers ask for most often, and the operational consequences of the difference",
    [
      terms("Definitions first", "", [
        ["Forward", "A bilateral agreement to buy or sell an asset at an agreed price on a future date. Custom size, date and terms; settles once, at maturity.", "OTC lifecycle: confirmation, collateral under a CSA, maturity settlement. There is no daily cash flow to reconcile, but there is daily counterparty exposure."],
        ["Future", "A standardised exchange-traded contract to buy or sell at an agreed price on a fixed date, cleared by a CCP, margined daily.", "Exchange lifecycle: clearing files, daily margin, settlement prices, expiry and roll. There is a cash flow every single day."],
        ["Contract specification", "The exchange-defined terms: contract size, tick size and value, expiry months, settlement method, trading hours, first notice day.", "Specs change. A contract multiplier or tick-value change that is not loaded produces wrong notionals and wrong margin across a whole book."],
        ["Notional", "Quantity multiplied by price multiplied by the contract multiplier - the economic size the contract controls.", "Notional, not the premium or the margin, is the number risk limits and regulatory reports are built on."],
        ["Tick size / tick value", "The minimum price increment and the cash value of that increment per contract.", "Tick data in the security master drives PnL per tick. Wrong tick value silently scales PnL."],
        ["Mark to market (MTM)", "Revaluing a position at the current market price and recognising the change as PnL.", "For futures, MTM is realised in cash daily through variation margin; for forwards it is an unrealised valuation until maturity."],
        ["Initial margin (IM)", "Collateral posted up front to cover potential future exposure over a close-out period.", "IM is recalculated daily by the CCP. A model or parameter change on the CCP side can move IM materially with no position change."],
        ["Variation margin (VM)", "The daily cash settlement of the mark-to-market change.", "VM is a payment with a cutoff. A late VM payment is a default-management event, which is why margin call files sit on the critical path."],
        ["Margin call", "A demand for additional collateral when exposure exceeds what is posted.", "Margin call processing is deadline work: file in, exposure agreed, dispute raised or collateral moved, all before the cutoff."],
        ["CCP (central counterparty)", "The clearing house that novates a trade and becomes buyer to every seller and seller to every buyer.", "The CCP is the external truth for cleared positions and margin. Your position file reconciles to theirs, not the other way round."],
        ["Novation", "Replacing the original bilateral contract with two contracts facing the CCP.", "Explains why the counterparty on the booked trade is not the firm you executed with."],
        ["Open interest", "The number of contracts still outstanding, as opposed to volume traded.", "Falling open interest into expiry is the roll happening. It is a sanity check on whether your book rolled with the market."],
        ["Roll", "Closing a near-expiry contract and opening the next one to maintain exposure.", "Rolls are scheduled, high-volume, deadline-bound activity. A failed roll leaves the desk about to take delivery or lose exposure."],
        ["First notice day (FND)", "The first day the long can be assigned physical delivery on a deliverable contract.", "A financial player must be out before FND. Missing FND is how a trading desk accidentally owns physical oil or grain."],
        ["Last trading day / expiry", "The final day the contract trades, followed by cash settlement or delivery.", "Expiry processing is a batch with an unforgiving date. Positions must be closed, rolled, cash settled or delivered."],
        ["Settlement price", "The official exchange price used for daily margining and final settlement.", "Not the last traded price. Using the wrong one produces a margin dispute."],
        ["Basis", "The difference between the futures price and the spot price of the underlying.", "Basis moves explain PnL on a hedged book that looks like it should be flat."],
        ["Cost of carry", "Financing, storage and yield that connect spot and forward prices.", "The reason a forward price is not just today's price - the first thing to explain when someone says the forward 'looks wrong'."],
        ["Contango / backwardation", "Contango: forward above spot. Backwardation: forward below spot.", "Determines whether rolling a position earns or costs money, which shows up as a recurring PnL item on rolling strategies."]
      ]),
      table("Forward versus future - the answer they are listening for", "Same economic exposure, completely different operational load.",
        ["Dimension", "Forward", "Future"],
        [
          ["Where traded", "OTC, bilateral, negotiated", "Exchange order book"],
          ["Terms", "Fully customisable: size, date, underlying", "Standardised contract specification"],
          ["Counterparty", "The other firm", "The clearing house (after novation)"],
          ["Credit risk", "Bilateral counterparty risk, mitigated by CSA collateral", "CCP risk, mitigated by initial and variation margin and the default fund"],
          ["Cash flows", "Normally none until maturity (collateral aside)", "Variation margin every day"],
          ["Valuation", "Marked internally against a curve or forward price", "Exchange settlement price, published daily"],
          ["Closing out", "Negotiate an offsetting trade or terminate with the counterparty", "Trade the opposite contract; positions net automatically"],
          ["Liquidity", "Depends on the dealer", "Continuous on the exchange, concentrated in the front months"],
          ["Typical support work", "Confirmations, CSA collateral, maturity settlement, valuation inputs", "Clearing and margin files, settlement prices, expiry and roll, exchange sessions"],
          ["What breaks", "Confirmation mismatch, missing SSI, stale curve", "Margin file late, contract spec not loaded, roll or FND missed"]
        ]),
      terms("Pricing relationships worth memorising", "You are not expected to derive them; you are expected not to be surprised by them.", [
        ["Equity forward price", "F = S x e^((r - q) x T), where S is spot, r the funding rate, q the dividend yield and T the time to maturity.", "Explains why a forward moves when nothing traded: a dividend or funding change moved it. Useful when a desk queries a forward mark."],
        ["FX forward price", "F = S x (1 + r_quote x t) / (1 + r_base x t), quoted in the market as forward points added to spot.", "Forward points come from the interest rate differential, not from a view on the currency. A 'wrong' forward is usually a wrong deposit curve."],
        ["Covered interest parity", "Borrowing in one currency, converting and investing in another, then hedging the return with a forward, should earn the same as investing domestically.", "The framework behind FX forward pricing and the cross-currency basis you see when it does not hold."],
        ["Futures versus forward price", "They differ slightly when interest rates are correlated with the asset price, because futures margin cash flows are reinvested daily.", "A nice interview detail: the difference is a margining effect, not a pricing error."]
      ]),
      drill("Say it in one sentence", "", [
        ["What is the difference between a forward and a future?", "Same economic agreement - buy or sell at an agreed price on a future date - but a forward is bilateral, customised, settles once at maturity and carries counterparty credit risk, while a future is exchange-traded, standardised, novated to a clearing house and cash-settled every day through variation margin. Operationally the forward gives you confirmations and collateral, the future gives you daily margin and expiry management."],
        ["Why does a future have daily cash flows?", "Because the clearing house marks every position to the daily settlement price and moves the gain or loss in cash as variation margin, so credit exposure never accumulates. That is what lets the CCP face everyone."],
        ["What is initial margin versus variation margin?", "Initial margin is collateral held up front to cover the potential future loss if the position has to be closed out, sized by a risk model. Variation margin is the actual daily profit or loss on the position, paid in cash. IM protects against tomorrow; VM settles today."],
        ["What happens if a futures roll is missed?", "The position stays in the expiring contract. On a cash-settled contract it settles out and the desk loses the exposure it wanted; on a deliverable contract, past first notice day, it can be assigned physical delivery. Either way it is an escalation before expiry, not after."],
        ["What is contango and why does it matter?", "Contango is a forward price above spot, usually reflecting carry costs. A long position that keeps rolling in contango sells the cheap expiring contract and buys the more expensive next one, so the roll costs money over time - the roll yield is negative."]
      ])
    ],
    [["CME Group - contract specifications and clearing", "https://www.cmegroup.com/"],
     ["LCH - margin and clearing services", "https://www.lch.com/"]]);

  /* ------------------------------------------------------------------ */
  section("options", "Options: mechanics and Greeks",
    "Payoff, exercise, settlement, and the sensitivities that make risk systems page you",
    [
      terms("Contract mechanics", "", [
        ["Call option", "The right, not the obligation, to buy the underlying at the strike price.", "The buyer has a right and pays premium; the seller has an obligation and receives it. Assignment risk sits with the seller."],
        ["Put option", "The right, not the obligation, to sell the underlying at the strike price.", "Puts are the hedging instrument in most equity books, so put expiry processing is heavily watched."],
        ["Premium", "The price paid for the option, settled at trade time.", "Premium settlement is a cash flow on trade date conventions, separate from the exercise flow at expiry."],
        ["Strike", "The price at which the option can be exercised.", "Strikes are adjusted after corporate actions. An unadjusted strike is a valuation and exercise error."],
        ["European / American / Bermudan", "European: exercise only at expiry. American: any time up to expiry. Bermudan: only on set dates.", "American style creates early assignment, often just before an ex-dividend date. Your expiry batch has to handle unscheduled exercises."],
        ["Exercise vs assignment", "The holder exercises; the writer is assigned by the clearing house, usually at random or pro rata.", "Assignment arrives as an inbound event you did not initiate, on the day the market moved. Positions change without a trade."],
        ["Physical vs cash settlement", "Physical: the underlying is delivered. Cash: the in-the-money amount is paid.", "Index options are typically cash settled; single stock options are often physically settled, creating an equity position and a settlement obligation overnight."],
        ["Moneyness (ITM / ATM / OTM)", "In, at or out of the money relative to the strike.", "Drives auto-exercise thresholds at expiry. Options sitting near the money at expiry are the ones that create surprise positions."],
        ["Intrinsic vs time value", "Intrinsic is the immediate exercise value; time value is the rest of the premium.", "Explains why an option can lose value on a flat day - time value decayed."],
        ["Implied volatility", "The volatility that makes a model reproduce the market price of an option.", "It is an output of market prices, not an input from history. It reaches the book through the published volatility surface, so when a desk says vol is wrong they mean that dated artefact, not a realised calculation."],
        ["Skew / smile", "The pattern where implied volatility varies by strike - equity index options are usually more expensive on the downside.", "A flat or inverted surface after a bad build is a visible symptom of a broken calibration."],
        ["Open / close and auto-exercise", "Exchange rules for automatically exercising in-the-money options at expiry.", "Auto-exercise thresholds mean positions appear the morning after expiry. Expect a spike of position and settlement queries."],
        ["Put-call parity", "C - P = S x e^(-qT) - K x e^(-rT) for European options on the same strike and expiry.", "A quick arbitrage-free sanity check: if a system violates parity by a wide margin, an input is wrong."]
      ]),
      table("The Greeks - what each one means and what it breaks", "Support does not calculate Greeks, but must recognise which input feeds each one.",
        ["Greek", "Measures", "Input that drives it", "What a wrong value usually means"],
        [
          ["Delta", "Change in option value per unit change in the underlying", "Underlying price, forward, dividends, borrow", "Stale underlying price or a wrong contract multiplier"],
          ["Gamma", "Change in delta per unit change in the underlying", "Same as delta, plus time to expiry", "Expiry date wrong; gamma explodes near expiry by design"],
          ["Vega", "Change in option value per 1 point of implied volatility", "Volatility surface", "Vol surface stale, missing or badly calibrated"],
          ["Theta", "Change in option value as one day passes", "Calendar, time to expiry, holiday calendar", "Wrong business calendar or a maturity date parsed incorrectly"],
          ["Rho", "Change in option value per change in interest rates", "Discount curve", "Curve failed to build or the wrong curve was picked up"]
        ]),
      drill("Say it in one sentence", "", [
        ["Explain an option to someone outside finance.", "The buyer pays a premium for the right, but not the obligation, to buy (call) or sell (put) something at a fixed price by a fixed date. The seller takes the premium and takes on the obligation to deliver if the buyer exercises. The buyer's loss is capped at the premium; the seller's risk is not."],
        ["What is delta and why does the desk hedge it?", "Delta is how much the option's value moves for a one-unit move in the underlying, so it is the equivalent underlying position the option represents. Desks hedge it by trading the underlying or futures so that small market moves do not move the book, leaving them exposed to volatility rather than direction."],
        ["Why is vega a support concern?", "Vega is sensitivity to implied volatility, and implied volatility reaches the book through the published volatility surface. If the surface publication job fails or publishes a stale or badly calibrated surface, every vega number and every option mark in the book is wrong, with no market event to explain it."],
        ["Why would someone exercise an American call early?", "Just before an ex-dividend date, when the dividend the holder would capture by owning the shares is worth more than the remaining time value of the option. That is the classic early-assignment event, and it appears in your books as an unrequested position change."],
        ["What happens on expiry day operationally?", "In-the-money options are exercised or auto-exercised, out-of-the-money ones expire worthless, assignments are allocated to writers, and cash-settled contracts pay the settlement amount. The positions and cash have to be created in the books overnight, and near-the-money positions are the ones most likely to generate exceptions."]
      ])
    ],
    [["OCC - options clearing and exercise", "https://www.theocc.com/"],
     ["Cboe - options education and specifications", "https://www.cboe.com/"]]);

  /* ------------------------------------------------------------------ */
  section("rates", "Rates: bonds, swaps and curves",
    "The largest part of FICC, and the part whose incidents are always about missing inputs",
    [
      terms("Cash bonds", "", [
        ["Bond", "A debt security paying coupons and returning principal at maturity.", "Bond static data - coupon, frequency, day count, maturity, first coupon date - drives every cash flow. Bad static means wrong accrued interest and wrong settlement amounts."],
        ["Face / par / nominal", "The principal amount repaid at maturity, and the base for coupon calculation.", "Bond quantities are nominal amounts, not share counts. Treating 1,000,000 nominal as 1,000,000 units is a classic booking error."],
        ["Coupon", "The periodic interest payment, fixed or floating.", "Coupon payment dates are scheduled cash flows that must be generated and settled. A missing coupon is a cash break."],
        ["Clean vs dirty price", "Clean price excludes accrued interest; dirty (invoice) price includes it and is what actually settles.", "Vendors quote clean; settlement uses dirty. Mixing them produces a settlement amount mismatch with the counterparty."],
        ["Accrued interest", "Interest earned since the last coupon, calculated on a day count convention.", "The day count (ACT/360, ACT/365, 30/360, ACT/ACT) is reference data. A wrong convention gives a small, persistent, very annoying break."],
        ["Yield to maturity (YTM)", "The single discount rate that makes the bond's cash flows equal its price.", "The price/yield relationship is inverse. Useful for sanity checks on a mark."],
        ["Duration / modified duration", "Weighted average time to cash flows; modified duration approximates the percentage price change for a 1 percent yield move.", "The desk's headline interest rate risk number."],
        ["DV01 / PV01", "The change in present value for a one basis point move in rates.", "The unit risk limits are written in. If DV01 jumps with no trade, suspect a curve, a static-data or a position problem."],
        ["Convexity", "The curvature in the price/yield relationship that duration alone misses.", "Explains why duration-hedged books still move on large rate shocks."],
        ["Bond future and CTD", "A future on a notional bond, deliverable against a basket; the cheapest to deliver is the bond the short would rationally deliver, adjusted by a conversion factor.", "CTD and conversion factors are reference data refreshed per contract. Stale CTD data misprices the hedge."]
      ]),
      terms("Swaps and rate derivatives", "", [
        ["Interest rate swap (IRS)", "An exchange of a fixed rate for a floating rate on a notional amount. The notional is never exchanged.", "Cash flows are netted per payment date. The floating leg depends on a published fixing, which is the single most common missing input."],
        ["OIS", "A swap whose floating leg is an overnight rate compounded over the period.", "OIS curves are used for discounting. If OIS fixings do not load, discounting fails and the whole book fails to value."],
        ["Fixing / reset", "The observation of the reference rate that sets the floating coupon for a period.", "Fixings publish on a calendar at a time. Missing or late fixings are an everyday production incident with a known escalation path."],
        ["Risk-free rates (RFRs)", "The overnight benchmarks that replaced IBORs: SOFR (USD), SONIA (GBP), ESTR (EUR), TONA (JPY), SARON (CHF).", "USD LIBOR panels ended in June 2023. Legacy trades reference fallbacks and the conventions differ - compounded in arrears with lookback or observation shift."],
        ["Compounded in arrears", "The floating coupon is known only at the end of the period because the overnight rate is compounded daily through it.", "Payment amounts are calculated days before payment, not at period start. Late calculation is a payment risk, not just a report."],
        ["FRA (forward rate agreement)", "An agreement fixing an interest rate for a future period, cash settled at the start of that period.", "Settles discounted at fixing, which makes its cash flow timing different from a swap coupon."],
        ["Basis swap", "A swap exchanging two floating rates, for example one tenor against another or one index against another.", "Needs two curves, so it fails when either fails."],
        ["Swaption", "An option to enter an interest rate swap.", "Needs a rates volatility surface as well as curves - another dated artefact to check."],
        ["Cap / floor", "A strip of options on a floating rate, paying when the rate is above a cap or below a floor.", "Lifecycle is a sequence of caplets/floorlets with their own fixings."],
        ["Yield curve", "The relationship between rate and maturity, built from deposits, futures and swaps.", "Curve construction is a job with inputs, a build time and a published result. 'The curve did not build' is a full-book outage."],
        ["Discount vs forward curve", "The discount curve values future cash flows; the forward curve projects future floating rates.", "Multi-curve framework: they are different curves. A support engineer should know a book uses both."],
        ["CSA discounting", "Discounting collateralised trades using the rate paid on the posted collateral.", "Explains why the same trade values differently under different collateral agreements."],
        ["Day count convention", "The rule converting a period into a fraction of a year: ACT/360, ACT/365, 30/360, ACT/ACT.", "Small, silent and persistent when wrong - a common root cause for reconciliation differences of a few pennies per million."],
        ["Business day convention", "How a payment date that falls on a holiday is adjusted: following, modified following, preceding.", "Holiday calendars are reference data that expire. A missing calendar year is a January incident."]
      ]),
      drill("Say it in one sentence", "", [
        ["What is an interest rate swap?", "Two parties exchange interest payments on an agreed notional - typically one pays a fixed rate and receives a floating rate that resets against a published benchmark. The notional itself is never exchanged, only the net interest difference on each payment date. It is used to convert fixed exposure to floating or the reverse, and to take a view on rates."],
        ["The swap book will not value. What is your first hypothesis?", "A missing input rather than a broken engine: check whether today's fixings published and loaded, whether the discount and forward curves built and at what time, and whether the holiday calendar covers the dates being valued. Check input timestamps before restarting the valuation service."],
        ["What is DV01?", "The change in the present value of a position for a one basis point parallel move in the rate curve - the standard unit of interest rate risk. Desks set limits in DV01, so a DV01 that moves without a trade is a data or position problem worth investigating."],
        ["What replaced LIBOR and why does it matter operationally?", "Overnight risk-free rates: SOFR, SONIA, ESTR, TONA and SARON. Operationally the conventions changed - the rate is compounded in arrears with a lookback or observation shift rather than set at the start of the period - so the coupon amount is only known shortly before payment, which tightens the calculation and payment window."]
      ])
    ],
    [["ISDA - benchmark reform and fallbacks", "https://www.isda.org/"],
     ["New York Fed - SOFR reference rates", "https://www.newyorkfed.org/markets/reference-rates/sofr"],
     ["Bank of England - SONIA", "https://www.bankofengland.co.uk/markets/sonia-benchmark"]]);

  /* ------------------------------------------------------------------ */
  section("credit", "Credit derivatives",
    "CDS, indices and the events that change a trade without anyone trading it",
    [
      terms("Credit vocabulary", "", [
        ["Credit default swap (CDS)", "Protection against the default of a reference entity: the buyer pays a periodic coupon, the seller pays out if a credit event occurs.", "Coupon payments are scheduled on standard IMM dates. Credit events are inbound lifecycle events with tight deadlines."],
        ["Reference entity / obligation", "The issuer whose default is being protected against, and the specific debt referenced.", "Entity static data and the deliverable obligation list are reference data with legal consequence."],
        ["Credit spread", "The annual cost of protection, quoted in basis points.", "Spread marks are the pricing input for the credit book, sourced from a marking process rather than an exchange."],
        ["Running coupon and upfront", "Standardised CDS pay a fixed running coupon, typically 100bp for investment grade and 500bp for high yield, with the difference from the market spread paid as an upfront amount.", "The upfront amount is a settlement cash flow on trade date - a payment, not a valuation."],
        ["Recovery rate", "The assumed or auction-determined value of the defaulted debt, which determines the payout.", "The auction result is an external event that has to be loaded before settlement can be calculated."],
        ["Credit event", "Bankruptcy, failure to pay or restructuring, as determined by the ISDA Determinations Committee.", "Triggers a defined process ending in an auction and settlement. Support work is loading determinations, freezing trades and generating settlement."],
        ["CDX / iTraxx", "Standardised CDS indices on baskets of North American and European names.", "Indices roll to a new series twice a year, in March and September. An unapplied roll leaves you trading and valuing the wrong series."],
        ["Index roll", "The scheduled replacement of an index series with a new constituent list.", "A dated reference-data event. Missing it produces valuation and matching failures across every index trade."],
        ["Succession event", "A corporate reorganisation that moves the reference obligation to a successor entity.", "Reference-data surgery on live trades, determined externally and applied to your books."]
      ]),
      drill("Say it in one sentence", "", [
        ["Explain a CDS in plain language.", "It is insurance on a borrower's default. The protection buyer pays a regular coupon; if a defined credit event happens, the protection seller compensates them for the loss on the referenced debt, with the amount set by an auction that determines the recovery rate. It is used to hedge credit exposure or to take a view on a borrower's creditworthiness."],
        ["Why do index rolls matter to support?", "Twice a year the CDS index moves to a new series with a new constituent list and coupon. Every downstream system - pricing, risk, matching, reporting - needs the new series reference data on the roll date. If it is not loaded, trades in the new series fail to match or value while positions in the old series are marked against the wrong curve."]
      ])
    ],
    [["ISDA - credit derivatives determinations", "https://www.isda.org/"],
     ["Markit/S&P - CDS index families", "https://www.spglobal.com/"]]);

  /* ------------------------------------------------------------------ */
  section("fx", "FX and money markets",
    "The highest-volume, tightest-deadline flow in the bank",
    [
      terms("FX products", "", [
        ["Spot", "An FX trade for delivery on the standard value date, normally T+2 (T+1 for USD/CAD and a few pairs).", "Value date drives settlement. A wrong value date is a funding failure, not a display problem."],
        ["Base / quote currency", "In EUR/USD, EUR is the base and USD the quote: the rate is how much quote you pay per unit of base.", "Inverted pairs are a real production bug class. Always confirm the quoting convention before repairing a rate."],
        ["Pip / forward points", "The standard smallest increment of a quote, and the forward adjustment added to spot to get the forward rate.", "Forward points come from the interest rate differential. A 'wrong' forward is normally a wrong deposit curve or a wrong tenor."],
        ["FX forward / outright", "A single FX trade for a value date beyond spot.", "Settlement instructions and cutoffs by currency drive whether it settles on time."],
        ["FX swap", "A simultaneous spot and forward in opposite directions - one near leg and one far leg - used to move a value date or fund a currency.", "Two legs, two value dates, one trade. Legs that get split in a downstream system create phantom FX exposure."],
        ["NDF (non-deliverable forward)", "A forward on a restricted currency, cash settled in a convertible currency against a published fixing.", "Depends on a fixing published by an external source at a fixed time. A missing fixing stops settlement calculation for every NDF on that date."],
        ["Cross-currency swap", "An exchange of principal and interest in two currencies, with a basis spread.", "Combines FX and rates plumbing: two curves, two calendars, principal exchange at both ends."],
        ["FX option", "An option to exchange currencies at a strike, expiring at a specified cut.", "The cut (for example the 10am New York cut) is the expiry time, and expiry processing runs to it."],
        ["Tom-next", "A one-day FX swap rolling a position from tomorrow to the next day.", "The mechanism behind daily rollover charges on leveraged FX positions."],
        ["CLS / PvP", "CLS is the settlement system that settles both legs of an FX trade simultaneously (payment versus payment), removing the risk of paying and not receiving.", "CLS has strict submission cutoffs. Missing the cutoff pushes trades to bilateral settlement, which raises risk and manual work."],
        ["Value date / cutoff", "The date money moves, and the deadline by which instructions must be in.", "FX support is cutoff work. Every incident is measured against the next currency cutoff."]
      ]),
      terms("Money markets and short-term funding", "", [
        ["Repo", "Selling a security with an agreement to repurchase it later at a set price - economically a secured loan.", "Repo has two legs and a rate. Fails on either leg have funding consequences the same day."],
        ["Reverse repo", "The other side of a repo: lending cash against securities collateral.", "Same plumbing, opposite direction. Naming errors between the two sides are a common booking mistake."],
        ["Haircut", "The discount applied to collateral value to cover price risk.", "Haircut and eligibility data drive how much collateral is required. Stale eligibility data produces wrong margin calls."],
        ["GC vs special", "General collateral is any acceptable bond in a class; a special is a specific issue in demand that trades at a lower repo rate.", "Explains why a repo rate looks out of line - it may be a special, not a bad mark."],
        ["Securities lending", "Lending securities for a fee, usually against collateral, often to support short selling.", "Recalls, rate changes and returns arrive as daily files that drive the borrow availability short sellers depend on."],
        ["Treasury bill / commercial paper", "Short-dated discount instruments issued by governments and companies.", "Discount instruments have a different price/yield calculation from coupon bonds - a common booking error."],
        ["Rehypothecation", "Reusing client collateral for the firm's own funding, within agreed limits.", "Drives reporting and limit checks on the financing side."]
      ]),
      drill("Say it in one sentence", "", [
        ["What is an FX swap and who uses one?", "A simultaneous purchase and sale of a currency for two different value dates - a near leg and a far leg. It has essentially no FX directional risk; it moves cash from one currency and date to another, so treasury desks use it for funding and traders use it to roll a spot position forward."],
        ["What is an NDF and what does support need to watch?", "A forward on a currency that cannot be freely delivered, cash settled in a convertible currency using an officially published fixing on a set date. Support watches the fixing: if it does not publish or does not load, the settlement amount cannot be calculated for every NDF fixing that day."],
        ["Why does CLS matter?", "It settles both legs of an FX trade at the same time, so you never pay one currency and fail to receive the other - the risk that caused the Herstatt failure. Operationally it means hard submission cutoffs, and missing them moves the trade to riskier bilateral settlement."],
        ["Explain repo to a new joiner.", "It is a secured loan dressed as two trades: you sell a bond today and agree to buy it back later at a slightly higher price. The difference is the interest, the bond is the collateral, and the haircut is the safety margin the lender keeps."]
      ])
    ],
    [["CLS Group - settlement risk mitigation", "https://www.cls-group.com/"],
     ["BIS - FX and OTC derivatives markets", "https://www.bis.org/statistics/"]]);

  /* ------------------------------------------------------------------ */
  section("commodities", "Commodities",
    "Where 'the trade expired' can mean a tanker is now yours",
    [
      terms("Commodity vocabulary", "", [
        ["Physical vs financial settlement", "Physical contracts deliver the commodity; financial contracts settle in cash against a published price.", "The difference decides whether missing an expiry is an accounting problem or a logistics problem."],
        ["Benchmark grades", "Standardised reference products such as WTI and Brent crude, or LME grade metals.", "Contract identity matters: Brent and WTI are different contracts with different settlement mechanics."],
        ["First notice day", "The first date the holder of a long deliverable contract can be assigned delivery.", "Financial participants must exit before FND. It is a hard date in the roll calendar."],
        ["Warehouse receipt / warrant", "A document of title to metal held in an approved warehouse.", "Physical inventory records reconcile to these, not to the trading book."],
        ["Loco / allocated vs unallocated", "Where precious metal sits (for example loco London) and whether specific bars are assigned to you.", "Allocated and unallocated positions are different claims with different settlement and credit treatment."],
        ["EFP (exchange for physical)", "Trading a futures position against an equivalent physical position off exchange, reported to the exchange.", "Arrives as a privately negotiated trade, so it follows a different booking route from screen trades."],
        ["Roll yield", "The gain or loss from rolling a futures position along the curve.", "Recurring, expected PnL on rolling strategies. Explain it before calling it a break."],
        ["Storage and carry", "Physical costs that push forward prices above spot.", "The economic reason commodity curves usually differ from financial ones."]
      ]),
      drill("Say it in one sentence", "", [
        ["Why is first notice day a production support issue?", "Because a long deliverable futures position held past first notice day can be assigned physical delivery. Support owns the monitoring that shows which deliverable positions remain open as FND approaches, and escalating late is not recoverable by a batch rerun."]
      ])
    ],
    [["CME Group - energy and metals contract specifications", "https://www.cmegroup.com/"],
     ["London Metal Exchange", "https://www.lme.com/"]]);

  /* ------------------------------------------------------------------ */
  section("financing", "Collateral, margin and financing",
    "The daily deadline machine behind every derivative book",
    [
      terms("Collateral vocabulary", "", [
        ["CSA (credit support annex)", "The annex to an ISDA master agreement that defines collateral: eligible assets, thresholds, minimum transfer amounts, frequency.", "CSA terms are reference data your margin engine depends on. An amended CSA not loaded produces systematically wrong calls."],
        ["ISDA master agreement", "The standard contract governing OTC derivatives between two parties.", "Netting rights under the master are what makes exposure a net number rather than a gross one."],
        ["Threshold / minimum transfer amount", "The exposure allowed before collateral is called, and the smallest amount that will actually be moved.", "Explains why a call was not issued even though exposure exists - usually correct, not a bug."],
        ["Tri-party collateral", "A third-party agent that holds and allocates collateral between the two sides.", "Adds an external file interface with its own cutoffs to your collateral chain."],
        ["Margin dispute", "The two sides calculate different exposure and disagree on the call amount.", "A workflow with deadlines, not an error. Support supplies the trade-level comparison that identifies the population causing the difference."],
        ["Initial margin models", "Standardised models such as ISDA SIMM for uncleared margin, and CCP proprietary models for cleared.", "Model versions and parameter sets are dated artefacts. A version mismatch between you and the counterparty produces a dispute."],
        ["Haircut / eligibility", "The discount applied to a collateral asset and whether it is acceptable at all.", "Eligibility schedules change; stale schedules mean you post collateral that is rejected."],
        ["Margin call file", "The daily file or message set exchanging exposure and call amounts.", "Sits on the critical path with a hard cutoff, which is why it is usually a P1 when it is late."],
        ["Prime brokerage financing", "The lending of cash and securities that funds a hedge fund's leveraged positions.", "PB margin and financing files drive a fund's available buying power at start of day."]
      ]),
      drill("Say it in one sentence", "", [
        ["The margin call file is late. Why is that a P1?", "Because the call has a contractual cutoff. If collateral does not move by the deadline, the firm is exposed and can be in breach of the CSA or clearing rules, which is a credit and regulatory issue rather than a delayed report. The escalation is framed against the cutoff time, not the job failure."],
        ["What is a margin dispute and what does support contribute?", "The two sides calculate different exposure and therefore different collateral. Support contributes the evidence: the trade population each side used, the marks and inputs on both, and the timestamped extract that shows where the populations diverge - usually a missing trade, a stale mark or a different model version."]
      ])
    ],
    [["ISDA - margin and collateral", "https://www.isda.org/"],
     ["ISDA SIMM methodology", "https://www.isda.org/category/margin/isda-simm/"]]);

  /* ------------------------------------------------------------------ */
  section("risk", "Valuation, PnL and risk vocabulary",
    "The numbers the desk checks at 08:00, and what your systems must have produced for them to exist",
    [
      terms("Valuation", "", [
        ["Mark / mark-to-market", "The current value assigned to a position from an observable market price.", "Marks come from a defined source at a defined time. 'Which source, as of when' is the first question on any valuation ticket."],
        ["Mark-to-model", "Valuation from a model when no observable price exists.", "Model inputs and versions are controlled artefacts. A model or parameter change is a change event that must be traceable."],
        ["Present value (PV) / NPV", "Today's value of future cash flows discounted at the appropriate rate.", "PV depends on the discount curve, so a curve failure is a full-book valuation failure."],
        ["Fair value hierarchy", "Level 1 quoted prices, Level 2 observable inputs, Level 3 unobservable inputs.", "Explains why some positions need an independent price verification process and others do not."],
        ["Independent price verification (IPV)", "A control function independently checking the desk's marks against external sources.", "IPV runs on a cycle with data extracts. Support keeps those extracts complete and reproducible."],
        ["Official close / snap time", "The agreed time and source at which the book is marked.", "Marking at the wrong snap produces a PnL move that is entirely artificial."],
        ["XVA (CVA, DVA, FVA)", "Valuation adjustments for counterparty credit, own credit and funding costs.", "Computed in heavy overnight grids with many inputs; a partial grid result is worse than no result because it looks complete."]
      ]),
      terms("PnL and risk", "", [
        ["Realised vs unrealised PnL", "Realised is locked in by closing a position or receiving cash; unrealised is the change in value of an open position.", "Both appear in the daily PnL. Knowing which is which stops you chasing a 'missing' number that has simply moved category."],
        ["PnL explain / attribution", "Decomposing the day's PnL into market moves (delta, gamma, vega, carry), new trades and residual.", "A large unexplained residual is the desk's smoke alarm, and it is often a data problem rather than a trading one."],
        ["Carry / theta PnL", "The PnL that accrues purely from time passing - financing, coupon accrual, time decay.", "Expected and predictable. If carry is missing, an accrual job did not run."],
        ["VaR (value at risk)", "The loss level not expected to be exceeded over a horizon at a confidence level, from historical or simulated scenarios.", "VaR runs are long, data-hungry batch jobs with a delivery deadline to risk management and sometimes to the regulator."],
        ["Stress test / scenario", "Revaluing the book under defined shocks rather than statistical moves.", "Scenario definitions are dated reference data; a missing scenario set makes the run incomplete rather than failed."],
        ["Sensitivity / greeks report", "Position-level risk sensitivities delivered to the desk each morning.", "Late sensitivities means the desk trades blind at the open - a business impact you can state clearly in an escalation."],
        ["Limit and breach", "A risk limit set by size, sensitivity or VaR, and the event of exceeding it.", "A breach caused by bad data still has to be reported and explained. Fixing the data does not remove the breach record."],
        ["Position keeping", "Maintaining the authoritative record of what the firm holds, rolled daily.", "Start-of-day position equals prior close plus fills plus lifecycle events. That equation is your diagnostic tool."],
        ["Books and records", "The official accounting record of trades and positions.", "Repairs to books and records need an audit trail. Direct data edits without a controlled process are a compliance problem."]
      ]),
      table("Symptom to first check - the table to have in your head", "This is the pattern interviewers are probing when they ask 'what would you do first'.",
        ["Symptom on the desk", "Most likely cause", "First evidence to pull"],
        [
          ["Position halved or doubled overnight, no trades", "Corporate action (split, consolidation) applied to price but not quantity", "Corporate action record and ex-date; prior close position; vendor notification"],
          ["Whole book fails to value", "Curve build or vol surface publication failed upstream", "Input artefact timestamps and job logs, in dependency order"],
          ["Large PnL on an untraded swap", "Missed reset or stale fixing", "Reset schedule, fixing load log, last successful reset date"],
          ["Positions match, cash does not", "Missing statement, dividend or fee accrual", "Nostro statement sequence numbers and balance continuity"],
          ["Bulk one-sided recon breaks", "Missing or partial inbound file, or a changed mapping", "File arrival time and row counts versus the prior day"],
          ["Orders rejected at the open", "Reference data or session problem, not the order", "Reject text and reason code, session logon state, security master change log"],
          ["Fills in the broker file, not in positions", "Drop copy or downstream consumer lag, or dedupe dropped them", "Execution ids on both sides; consumer checkpoint versus session sequence"],
          ["Risk numbers late", "Overnight grid or batch dependency slipped", "Critical path job timings versus the delivery deadline"]
        ]),
      drill("Say it in one sentence", "", [
        ["What is PnL explain and why do you care?", "It decomposes the day's profit and loss into the pieces that should explain it - market moves through the Greeks, carry, new trades - leaving a residual. A large residual means something in the valuation chain is not what the desk thinks it is, and very often the cause is a data or process failure that support owns rather than a trading decision."],
        ["Risk numbers will be an hour late. How do you escalate?", "State the business impact against the deadline, not the technical fault: which report, which desks, what they cannot do without it, the expected delivery time and confidence, and what has already been ruled out. Offer the partial or prior-day position if it is usable, and say explicitly what it is not safe to use it for."]
      ])
    ],
    [["Basel Committee - market risk framework", "https://www.bis.org/bcbs/"],
     ["FASB - fair value measurement", "https://www.fasb.org/"]]);

  /* ------------------------------------------------------------------ */
  section("regs", "Regulation and reporting you will be asked to name",
    "Not law revision - the operational obligations that create your deadlines",
    [
      terms("Reporting regimes", "", [
        ["MiFID II / MiFIR", "The EU framework covering transaction reporting, trade transparency, best execution and algorithmic trading controls.", "Transaction reports go to a regulator through an ARM by close of the following working day. Rejections must be corrected and resubmitted - the rejected subset, not the whole file."],
        ["RTS 25 (clock synchronisation)", "The MiFIR standard requiring business clocks to be synchronised to UTC within a defined tolerance, tighter for low-latency activity.", "Clock drift is a reportable compliance failure and produces venue rejects on SendingTime. It is a classic FIX and Linux crossover incident."],
        ["RTS 6 (algorithmic trading)", "Requirements for testing, controls and kill functionality for algorithmic trading.", "Kill switch and throttle controls are operational features you may be asked to exercise during an incident."],
        ["EMIR", "The EU regime for derivatives: reporting to a trade repository, clearing obligation and risk mitigation.", "Both sides report, so break resolution is a bilateral matching exercise using the UTI."],
        ["SFTR", "EU reporting for securities financing transactions - repo and securities lending.", "Adds a reporting obligation to the financing chain, with its own daily cutoff."],
        ["Dodd-Frank", "The US framework covering swap reporting, clearing and execution.", "Its real-time reporting requirements are minutes, not end of day."],
        ["CAT (Consolidated Audit Trail)", "The US audit trail requiring order and execution events to be reported with timestamps.", "Timestamp precision and event completeness are the operational requirements, which puts clock and event logging squarely in support scope."],
        ["Trade vs transaction reporting", "Trade (post-trade transparency) reporting publishes executions to the market quickly. Transaction reporting sends a detailed record to the regulator afterwards.", "Different destinations, deadlines and content. Mixing them up in an incident call is an obvious tell."],
        ["APA / ARM", "Approved Publication Arrangement publishes trade reports; Approved Reporting Mechanism submits transaction reports to the regulator.", "Both are external endpoints with feedback files you have to reconcile against."],
        ["CSDR settlement discipline", "EU regime imposing cash penalties for settlement fails and mandatory buy-in provisions.", "Turns settlement fails into a measurable daily cost, which raises the priority of settlement exceptions."],
        ["Best execution", "The obligation to take sufficient steps to get the best result for clients.", "Depends on complete and accurate execution records, including venue (FIX tag 30) and timestamps."],
        ["Market abuse / surveillance", "Monitoring for insider dealing and manipulation, using order and trade data.", "Surveillance consumes your order and execution feeds. A gap in the feed is a surveillance gap, which is escalated differently from a data gap."]
      ]),
      terms("Identifiers", "Interviewers ask these to test whether you have actually handled reference data.", [
        ["ISIN", "The 12-character global security identifier.", "The common key between systems and the one regulators expect."],
        ["CUSIP / SEDOL", "North American and UK/Irish security identifiers.", "Regional identifiers that must map to the ISIN in the security master."],
        ["RIC / Bloomberg ticker", "Vendor-specific instrument codes from Refinitiv and Bloomberg.", "Vendor codes are not stable identifiers. Mapping tables between vendor codes and ISINs are a classic source of silent breaks."],
        ["LEI", "The Legal Entity Identifier for a counterparty or issuer.", "LEIs expire and must be renewed. A lapsed LEI causes transaction report rejections in bulk for one counterparty."],
        ["UTI / UPI", "Unique Transaction Identifier for a trade and Unique Product Identifier for the product type.", "The UTI is what the two sides of a reported derivative match on. UTI mismatches are a standard EMIR break type."],
        ["MIC", "Market Identifier Code for a trading venue.", "Appears on reports and in FIX tag 30 LastMkt. Venue identification drives reporting and surveillance."],
        ["CFI code", "A code classifying the instrument type and its main features.", "Used in reporting and to derive product behaviour when full static is unavailable."]
      ]),
      drill("Say it in one sentence", "", [
        ["What is RTS 25 and why would it page you?", "It is the MiFIR clock synchronisation standard: business clocks used for reportable events must track UTC within a defined tolerance, with tighter limits for low-latency trading. If the time source degrades - a lost PTP grandmaster, an NTP fallback drifting - venues start rejecting on SendingTime accuracy and your reported timestamps become non-compliant, so it is both a connectivity incident and a regulatory one."],
        ["Transaction reports were rejected. What is the correct response?", "Read the rejection reasons and look for clustering: bulk rejections almost always trace to one field or one counterparty attribute, such as a lapsed LEI or a missing instrument reference, rather than to many different errors. Fix the underlying data, resubmit only the rejected subset with the correct identifiers, confirm acceptance in the feedback file, and record the cause - reporting deadlines apply to the corrections too."]
      ])
    ],
    [["ESMA - MiFID II and MiFIR", "https://www.esma.europa.eu/"],
     ["FCA - transaction reporting", "https://www.fca.org.uk/"],
     ["FINRA CAT", "https://www.catnmsplan.com/"]]);

  /* ------------------------------------------------------------------ */
  section("systems", "Systems, data and the support surface",
    "The boxes on the architecture diagram you will be asked to draw",
    [
      terms("Trading and post-trade systems", "", [
        ["OMS (order management system)", "Manages the order lifecycle for a desk or fund: creation, compliance checks, routing, fills, allocations.", "The OMS is the buy-side system of record for orders. Most 'where is my order' tickets start here."],
        ["EMS (execution management system)", "The trader-facing tool for working orders in the market, with algos and venue access.", "Latency-sensitive and venue-connected; incidents are usually connectivity or market data."],
        ["SOR (smart order router)", "Splits and routes orders across venues to get the best outcome.", "Venue configuration and market data quality directly drive routing decisions. Bad data routes badly."],
        ["Algo container", "The process running execution algorithms such as VWAP, TWAP, POV and implementation shortfall.", "Kill switches, throttles and per-strategy limits are operational controls you may need to use under pressure."],
        ["FIX gateway / engine", "The process maintaining FIX sessions with venues and clients and translating messages to internal formats.", "Sequence numbers, session state and message stores are the artefacts you work with in a FIX incident."],
        ["Market data feed handler", "Decodes an exchange feed - often UDP multicast, A and B lines - and publishes normalised prices internally.", "Packet loss, gap recovery, conflation and book-building failures all appear to users as 'prices are stale'."],
        ["Ticker plant / kdb+", "The time-series capture and query layer for market and trade data, commonly kdb+ with realtime and historical databases.", "The intraday RDB holds the day in memory and writes down overnight. A failed writedown leaves it carrying two days, which is a memory incident with a hard deadline at the next open."],
        ["Trade capture / booking system", "Where an execution becomes a booked trade with full economics.", "The bridge from execution to books. Failures here strand trades between the desk and the back office."],
        ["Position keeper", "Maintains real-time and end-of-day positions per book and account.", "Rebuilding a position from SOD plus fills plus events is a core support skill."],
        ["Risk engine", "Revalues the book and computes sensitivities, VaR and limits.", "Compute-heavy and input-dependent: usually fails because of missing inputs rather than its own code."],
        ["Pricing library / quant service", "Shared valuation code used by trading, risk and finance.", "Library version changes move valuations. Version and release dates belong in your incident timeline."],
        ["Reference / static data (security master)", "The instrument, counterparty, calendar and account data every system depends on.", "Reference data changes are the most under-appreciated cause of production incidents. Treat a static-data load as a change."],
        ["Recon engine", "Matches two records and raises exceptions for the differences.", "Understanding the matching keys and tolerances tells you why a break is a break."],
        ["Settlement / SWIFT interface", "Generates and receives settlement messages with custodians and counterparties.", "MT540-543 for securities settlement, MT535/536 for holdings and transactions, MT940/950 for cash statements."],
        ["Message bus", "The transport between systems: IBM MQ, Kafka, Tibco EMS or similar.", "Queue depth, consumer lag, poison messages and redelivery limits are daily vocabulary."],
        ["Batch scheduler", "Control-M, Autosys or similar, running the overnight dependency graph.", "Know the critical path, the deadline and which downstream consumer breaks first when a job slips."]
      ]),
      terms("Data and interfaces", "", [
        ["Market data vs reference data", "Market data changes continuously (prices, quotes, trades). Reference data describes the instrument and changes on events.", "Different failure modes and different fixes: market data problems are about flow, reference data problems are about state."],
        ["Snapshot vs incremental", "A full picture of the book versus a stream of changes applied to it.", "A book built from increments after a missed snapshot is silently wrong. Recovery means resynchronising, not restarting."],
        ["Conflation", "Collapsing several updates into the latest one when a consumer cannot keep up.", "Explains legitimate differences between a feed and a slow consumer - not every difference is a defect."],
        ["Drop copy", "A read-only copy of executions sent to middle office, risk or a third party.", "A healthy drop copy session proves the transport works but not that every source session is mapped into it."],
        ["Vendor feeds", "Bloomberg, Refinitiv, ICE and similar providers of prices and reference data.", "Vendor entitlements and file schedules are external dependencies with their own incident channels."],
        ["End-of-day file delivery", "Extracts sent to administrators, custodians, prime brokers and regulators.", "Row counts and control totals are the verification. A delivered empty file is worse than a late one."]
      ]),
      drill("Say it in one sentence", "", [
        ["Draw the order flow for a hedge fund.", "Portfolio manager raises an order in the OMS, pre-trade compliance and risk checks run, the order goes to the EMS or directly out over a FIX session to a broker or venue, executions come back as ExecutionReports, fills update positions and risk, the block is allocated to funds, trades are confirmed and affirmed, the prime broker and administrator files reconcile overnight, and the NAV and risk reports are produced for the morning."],
        ["Prices are stale on one screen only. How do you narrow it?", "Separate arrival from delivery: confirm packets are arriving at the host (interface and socket counters), that the feed handler is publishing and not stalled, that the internal distribution is flowing, and only then look at the one consumer. If arrival is fine and one consumer is behind, it is a consumer or subscription problem, not a market data outage."]
      ])
    ],
    [["IBM MQ documentation", "https://www.ibm.com/docs/en/ibm-mq"],
     ["Apache Kafka documentation", "https://kafka.apache.org/documentation/"],
     ["kdb+ product documentation", "https://code.kx.com/q/"]]);

  /* ------------------------------------------------------------------ */
  section("fixbasics", "FIX: framing and the session layer",
    "What a FIX message is, and the seven administrative messages that keep a session alive",
    [
      terms("What FIX actually is", "", [
        ["FIX (Financial Information eXchange)", "The industry messaging standard for orders, executions, quotes, market data and post-trade messages between firms and venues.", "Nearly every order that leaves a firm leaves over FIX. Reading a raw FIX log is a core production support skill, not a specialism."],
        ["tag=value encoding", "Each field is a numeric tag, an equals sign and a value, terminated by the SOH character (ASCII 0x01).", "SOH is non-printable. Logs and tools usually show it as | or ^A. When you grep, match the delimiter explicitly so 39=1 does not also match 39=10."],
        ["Session layer vs application layer", "The session layer guarantees ordered, recoverable delivery (logon, sequence numbers, heartbeats, resend). The application layer carries the business messages.", "The single most useful diagnostic split in FIX: is this a transport and session problem, or is the session healthy and the business message wrong or rejected?"],
        ["FIX session", "A bilateral, long-lived, sequenced conversation identified by BeginString, SenderCompID and TargetCompID.", "A session has its own message store and sequence counters on disk. Session identity is configuration, and reusing another session's store is a serious mistake."],
        ["Sequence numbers", "Each side numbers its outbound messages from 1 upward, and expects the peer's inbound numbers in unbroken order.", "Gap detection and recovery are built on these. Never reset them unilaterally to make an error go away."],
        ["Data dictionary", "The XML definition of which tags and enumerations are valid for a message type in a given FIX version or venue variant.", "Venue-specific dictionaries matter. Most 'engine rejected a valid message' reports are actually a dictionary mismatch."],
        ["Custom tags", "User-defined fields numbered 5000 and above, and venue extensions.", "Never assume a custom tag means the same thing on two venues - it is the definition of a bilateral agreement."],
        ["Repeating group", "A block of fields repeated a counted number of times, introduced by a NoXxx count tag.", "Order inside a repeating group is defined by the dictionary. Out-of-order group fields are a common session reject (373=15 or 373=16)."],
        ["FIX versions", "FIX 4.2 and 4.4 are still widespread; FIX 5.0 SP2 splits the session layer into FIXT 1.1 so the transport can version independently.", "Know which version a session runs - enumerations changed between versions, most notably around ExecType and OrdStatus."],
        ["FIXT 1.1", "The separated session-layer specification used with FIX 5.0 and later, where the application version is carried in tags 1128/1137.", "If BeginString is FIXT.1.1, the application version comes from DefaultApplVerID, not from BeginString."],
        ["FIXML / FAST / SBE", "Alternative encodings: XML for post-trade, FAST and Simple Binary Encoding for high-throughput market data.", "You may support a venue whose market data is SBE while its orders are tag=value FIX."]
      ]),
      table("Message framing - the three fields that must be right", "",
        ["Tag", "Field", "Rule"],
        [
          ["8", "BeginString", "Always the first field. FIX.4.2, FIX.4.4 or FIXT.1.1"],
          ["9", "BodyLength", "Always second. Character count from the field after BodyLength's SOH up to and including the SOH before the CheckSum tag"],
          ["10", "CheckSum", "Always last. Sum of every byte of the message before it, modulo 256, written as exactly three digits"]
        ]),
      table("Administrative (session) messages", "These seven keep the session alive. Learn what each one is for and when it is legitimate to send it.",
        ["MsgType (35)", "Message", "Purpose", "Key fields"],
        [
          ["A", "Logon", "Establish the session, agree heartbeat interval, optionally reset sequence numbers", "108 HeartBtInt, 141 ResetSeqNumFlag, 98 EncryptMethod, 789 NextExpectedMsgSeqNum, 1137 DefaultApplVerID"],
          ["0", "Heartbeat", "Prove the session is alive during quiet periods; also the reply to a TestRequest", "112 TestReqID when replying"],
          ["1", "TestRequest", "Ask the peer to prove it is alive after a quiet interval", "112 TestReqID, which must be echoed back"],
          ["2", "ResendRequest", "Ask the peer to resend a range of messages after a detected gap", "7 BeginSeqNo, 16 EndSeqNo (0 means through the end)"],
          ["4", "SequenceReset", "Move the peer's expected sequence number forward, as a gap fill or a hard reset", "36 NewSeqNo, 123 GapFillFlag"],
          ["3", "Reject", "Session-level rejection of a malformed or invalid message", "45 RefSeqNum, 371 RefTagID, 372 RefMsgType, 373 SessionRejectReason, 58 Text"],
          ["5", "Logout", "End the session cleanly, or signal an unrecoverable session condition", "58 Text usually carries the reason"]
        ]),
      terms("Session mechanics worth knowing cold", "", [
        ["Logon handshake", "The initiator sends Logon; the acceptor validates identity and replies with Logon. HeartBtInt is agreed here.", "Most logon failures are identity or configuration: wrong CompIDs, wrong port, wrong FIX version, IP not allowed, session outside its schedule, or already logged on elsewhere."],
        ["Heartbeat interval", "Agreed in tag 108. If nothing is sent within the interval, a Heartbeat is sent; if nothing is received, a TestRequest is sent.", "Correlate the TestReqID in tag 112 across both logs to prove which side stopped responding."],
        ["Gap detection", "Receiving a MsgSeqNum higher than expected means messages are missing, and the receiver issues a ResendRequest.", "'MsgSeqNum too low' means the opposite: the peer sent a number already used, which usually means its store was reset or is out of step."],
        ["GapFill vs reset", "SequenceReset with GapFillFlag=Y skips administrative messages that need not be replayed. SequenceReset without it is a hard reset of the expected number.", "GapFill is routine during replay. A hard reset discards recovery ability and needs bilateral agreement."],
        ["ResetSeqNumFlag (141=Y)", "A Logon requesting that both sides reset sequence numbers to 1.", "Legitimate only by agreement, typically at a session start of day. Using it to clear an error destroys the evidence of what was missed."],
        ["PossDupFlag (43=Y)", "Marks a message as a possible duplicate of one already sent with the same sequence number, normally during a resend.", "Deduplicate these on MsgSeqNum. OrigSendingTime (122) carries the original send time."],
        ["PossResend (97=Y)", "Marks an application-level resend under a new sequence number.", "Deduplicate these on the business identifier - ExecID or ClOrdID - because the sequence number is new."],
        ["Message store", "Persisted outbound messages and sequence counters, so a resend can be satisfied after a restart.", "Deleting or swapping a store to clear an error is how a firm loses the ability to replay. Preserve it, then recover."],
        ["Session schedule", "Sessions have start and end times; at end of day counters normally reset.", "A session outside its schedule refuses to log on, which looks like a connectivity failure and is not."],
        ["Sequence number persistence", "Counters survive restarts, which is what makes recovery possible.", "A counter that unexpectedly starts at 1 after a restart means the store did not load - check the path and the configured session id."]
      ]),
      sample("A session in raw form", "SOH is shown as | as most log viewers do.", [
        ["Logon, initiator to acceptor",
         "8=FIX.4.4|9=74|35=A|34=1|49=BUYSIDE1|56=VENUEX|52=20260914-07:00:00.120|98=0|108=30|141=N|10=028|",
         "MsgSeqNum starts at 1 for the session. 108=30 agrees a 30 second heartbeat. 141=N means do not reset counters - that is the normal production case."],
        ["Quiet session, liveness check",
         "8=FIX.4.4|9=62|35=1|34=87|49=VENUEX|56=BUYSIDE1|52=20260914-11:31:02.004|112=TR-1731|10=141|\n8=FIX.4.4|9=62|35=0|34=142|49=BUYSIDE1|56=VENUEX|52=20260914-11:31:02.031|112=TR-1731|10=097|",
         "The TestRequest carries TestReqID TR-1731 and the Heartbeat echoes it. If the echo never appears, the peer, not the network, is the thing to prove."],
        ["Gap and recovery",
         "8=FIX.4.4|35=2|34=143|49=BUYSIDE1|56=VENUEX|7=88|16=0|...\n8=FIX.4.4|35=4|34=88|43=Y|122=20260914-11:29:58.001|36=93|123=Y|...\n8=FIX.4.4|35=8|34=93|43=Y|122=20260914-11:30:41.880|...",
         "ResendRequest asks from 88 to the end (16=0). The peer gap fills the administrative messages to 93 and replays the business messages with PossDupFlag=Y and the original SendingTime in 122."]
      ]),
      drill("Say it in one sentence", "", [
        ["What is the difference between the FIX session layer and the application layer?", "The session layer is the reliable, ordered transport: logon, sequence numbers, heartbeats, test requests, resend and reject. The application layer is the business content: orders, executions, quotes, allocations. Splitting the two is the first diagnostic step - a session problem affects everything on the session, an application problem affects specific messages."],
        ["You see 'MsgSeqNum too low, expecting 4821 but received 12'. What happened?", "The peer sent a sequence number the session has already passed, which almost always means their side reset or lost its message store, or you are connected to a different instance than you think. It is not fixed by resetting your own counter - you establish with the counterparty what they did, reconcile which messages were actually exchanged, and then agree a recovery, which may be a controlled bilateral reset."],
        ["When is it acceptable to reset sequence numbers to 1?", "At an agreed session start of day if that is the configured convention, or as an explicitly agreed bilateral recovery action after both sides have reconciled what was sent and received. Never unilaterally during trading to clear an error, because it discards the ability to detect and replay what was missed."]
      ])
    ],
    [["FIX Trading Community - standards and specifications", "https://www.fixtrading.org/standards/"],
     ["QuickFIX/J documentation", "https://www.quickfixj.org/"]]);

  /* ------------------------------------------------------------------ */
  section("fixtags", "FIX: tags you must know cold",
    "If you can recite this table, you can read a FIX log live on an incident bridge",
    [
      table("Header and trailer", "Present on every message regardless of type.",
        ["Tag", "Field", "Why it matters"],
        [
          ["8", "BeginString", "FIX version, always the first field"],
          ["9", "BodyLength", "Byte count between the SOH after tag 9 and the SOH before tag 10"],
          ["10", "CheckSum", "Always last, three digits, sum of preceding bytes modulo 256"],
          ["35", "MsgType", "What kind of message this is - read it before anything else"],
          ["34", "MsgSeqNum", "Gap detection lives here"],
          ["49", "SenderCompID", "Who sent it"],
          ["56", "TargetCompID", "Who it is for - 49 and 56 together are the session identity"],
          ["50 / 57", "SenderSubID / TargetSubID", "Sub-identities within a session, often desk or trader"],
          ["115 / 128", "OnBehalfOfCompID / DeliverToCompID", "Third-party routing through an intermediary"],
          ["52", "SendingTime", "UTC send time. Rejects with 373=10 mean clock skew"],
          ["43", "PossDupFlag", "Y means a replay of an already-sent sequence number - deduplicate on 34"],
          ["97", "PossResend", "Y means an application resend under a new sequence number - deduplicate on ExecID or ClOrdID"],
          ["122", "OrigSendingTime", "The original SendingTime of a replayed message"],
          ["1128 / 1137", "ApplVerID / DefaultApplVerID", "Application version when the session is FIXT.1.1"]
        ]),
      table("Order and execution identity", "Identity confusion causes more position errors than any other FIX mistake.",
        ["Tag", "Field", "Why it matters"],
        [
          ["11", "ClOrdID", "The client's id for the order; must be unique per session per day"],
          ["41", "OrigClOrdID", "The ClOrdID this cancel or replace refers to"],
          ["37", "OrderID", "The broker's or venue's id, stable across replaces"],
          ["17", "ExecID", "Unique per execution report - deduplicate on this, never on quantity"],
          ["19", "ExecRefID", "The ExecID being corrected or cancelled by a bust or correction"],
          ["198", "SecondaryOrderID", "Venue-side secondary identifier, useful when reconciling with an exchange"],
          ["66", "ListID", "The identifier for a list or program trade"]
        ]),
      table("Order state and quantities", "These five fields, read together, tell you exactly where an order stands.",
        ["Tag", "Field", "Why it matters"],
        [
          ["39", "OrdStatus", "Where the order now stands"],
          ["150", "ExecType", "Why this particular report was sent"],
          ["151", "LeavesQty", "Still working; zero means the order is in a terminal state"],
          ["14", "CumQty", "Filled so far, cumulative across all fills"],
          ["6", "AvgPx", "Average price across all fills"],
          ["32 / 31", "LastQty / LastPx", "This fill only, not cumulative"],
          ["38 / 44", "OrderQty / Price", "As ordered"],
          ["99", "StopPx", "Trigger price for stop and stop-limit orders"],
          ["151 vs 14", "The identity", "For a simple working order, OrderQty = CumQty + LeavesQty. Terminal states legitimately show LeavesQty 0 with unfilled quantity"]
        ]),
      table("Order instructions", "Everything that describes what kind of order you actually sent.",
        ["Tag", "Field", "Common values"],
        [
          ["54", "Side", "1 Buy, 2 Sell, 5 Sell short, 6 Sell short exempt, 8 Cross"],
          ["40", "OrdType", "1 Market, 2 Limit, 3 Stop, 4 Stop limit, P Pegged"],
          ["59", "TimeInForce", "0 Day, 1 GTC, 2 OPG, 3 IOC, 4 FOK, 6 GTD, 7 At the close"],
          ["21", "HandlInst", "1 automated private, 2 automated public, 3 manual (CARE)"],
          ["528 / 529", "OrderCapacity / OrderRestrictions", "A Agency, P Principal, R Riskless principal, G Proprietary (tag 47 was the pre-4.3 field)"],
          ["18", "ExecInst", "Multi-valued: 1 not held, 6 participate don't initiate, G all or none, M mid-price peg, R primary peg"],
          ["110 / 111", "MinQty / MaxFloor", "Minimum executable quantity and the displayed size of an iceberg"],
          ["126 / 432", "ExpireTime / ExpireDate", "Required with GTD (TimeInForce 6)"],
          ["847", "TargetStrategy", "Which execution algorithm was requested"],
          ["1", "Account", "The account the order is for"],
          ["100", "ExDestination", "Where the order was directed"]
        ]),
      table("Instrument identity", "Getting the instrument wrong is a reference-data incident wearing a FIX costume.",
        ["Tag", "Field", "Why it matters"],
        [
          ["55", "Symbol", "The ticker; ambiguous across venues on its own"],
          ["48 / 22", "SecurityID / SecurityIDSource", "The unambiguous pair. 22: 1 CUSIP, 2 SEDOL, 4 ISIN, 5 RIC, 8 Exchange symbol"],
          ["167", "SecurityType", "CS common stock, FUT future, OPT option, CORP corporate bond, TNOTE, FXSPOT, and more"],
          ["207", "SecurityExchange", "The listing exchange"],
          ["15", "Currency", "Trade currency - not always the instrument's home currency"],
          ["461", "CFICode", "Instrument classification, the modern replacement for several older type fields"],
          ["200 / 541", "MaturityMonthYear / MaturityDate", "Derivative expiry"],
          ["202 / 201", "StrikePrice / PutOrCall", "Option strike and 0 Put, 1 Call"],
          ["231", "ContractMultiplier", "Units per contract - the source of silently scaled notionals"],
          ["555", "NoLegs", "Repeating group opening a multi-leg (spread or strategy) instrument"]
        ]),
      table("Venue, timing and post-trade", "",
        ["Tag", "Field", "Why it matters"],
        [
          ["30", "LastMkt", "Venue of execution - surveillance and best execution depend on it"],
          ["60", "TransactTime", "When the business event happened, as opposed to 52 SendingTime, when the message was sent"],
          ["75", "TradeDate", "The trading day the execution belongs to - not always the calendar date of the timestamp"],
          ["64 / 63", "SettlDate / SettlType", "Settlement date and convention (0 regular, 1 cash, 3 T+2 and so on)"],
          ["58", "Text", "The human-readable reason - read this first on any reject"],
          ["103", "OrdRejReason", "Why the order was rejected"],
          ["102 / 434", "CxlRejReason / CxlRejResponseTo", "Why a cancel or replace was rejected, and which request it answers"],
          ["453", "NoPartyIDs", "Repeating group of parties: 448 PartyID, 447 PartyIDSource, 452 PartyRole"],
          ["78", "NoAllocs", "Repeating group of allocations: 79 AllocAccount, 80 AllocQty (467 IndividualAllocID in 4.4)"],
          ["851", "LastLiquidityInd", "Whether the fill added or removed liquidity - drives venue fees"],
          ["880 / 573", "TrdMatchID / MatchStatus", "Venue match identity and matching state for trade capture"]
        ]),
      drill("Say it in one sentence", "", [
        ["Which fields link an order, a cancel and an execution?", "ClOrdID (11) identifies the client order, OrigClOrdID (41) points a cancel or replace at the order it refers to, OrderID (37) is the broker's stable id across replaces, and ExecID (17) uniquely identifies each execution report. State comes from OrdStatus (39) and ExecType (150), with CumQty (14) and LeavesQty (151) giving the quantities."],
        ["How do you deduplicate fills correctly?", "On ExecID (17), which is unique per execution report. Quantity and price are not unique - two genuine partial fills can be identical. Also check PossDupFlag (43) for session-level replays and PossResend (97) for application-level resends, and handle ExecType G (trade correct) and H (trade cancel) which refer to an earlier ExecID through ExecRefID (19)."],
        ["What is the difference between tag 52 and tag 60?", "SendingTime (52) is when the message was put on the wire; TransactTime (60) is when the business event actually occurred. Latency and clock investigations compare 52 against your local receive timestamp; business timing and reporting use 60."]
      ])
    ],
    [["FIX Trading Community - FIX 4.4 specification", "https://www.fixtrading.org/standards/fix-4-4/"],
     ["FIX field and message reference", "https://www.fixtrading.org/online-specification/"]]);

  /* ------------------------------------------------------------------ */
  section("fixmsgs", "FIX: message types and enumerations",
    "The MsgTypes you will meet, and the value tables interviewers ask you to recite",
    [
      table("Application message types (35=)", "Learn the first block cold; recognise the rest.",
        ["MsgType", "Message", "What it does"],
        [
          ["D", "NewOrderSingle", "Send a single order"],
          ["8", "ExecutionReport", "Every state change of an order: ack, fill, cancel, reject, expiry, restatement"],
          ["F", "OrderCancelRequest", "Request to cancel an existing order"],
          ["G", "OrderCancelReplaceRequest", "Request to amend an existing order (quantity, price, other terms)"],
          ["9", "OrderCancelReject", "Rejection of a cancel or replace request - note it is NOT an ExecutionReport"],
          ["H", "OrderStatusRequest", "Ask for the current state of an order"],
          ["E", "NewOrderList", "Submit a list or program trade"],
          ["AB / AC", "NewOrderMultileg / MultilegOrderCancelReplace", "Orders on multi-leg strategies and spreads"],
          ["q / r", "OrderMassCancelRequest / Report", "Cancel many orders at once - the operational kill action"],
          ["AF", "OrderMassStatusRequest", "Ask for the state of many orders, used to resynchronise after an outage"],
          ["j", "BusinessMessageReject", "Application-level rejection of a well-formed message"],
          ["V / W / X / Y", "MarketDataRequest / SnapshotFullRefresh / IncrementalRefresh / RequestReject", "Market data subscription and delivery"],
          ["R / S", "QuoteRequest / Quote", "RFQ workflow, common in FICC"],
          ["i / b", "MassQuote / MassQuoteAcknowledgement", "Market maker quoting"],
          ["c / d", "SecurityDefinitionRequest / SecurityDefinition", "Instrument reference data over FIX"],
          ["f", "SecurityStatus", "Trading status of an instrument (halt, resume)"],
          ["h", "TradingSessionStatus", "Venue session state - open, closed, halted"],
          ["J / P", "AllocationInstruction / AllocationInstructionAck", "Post-trade allocation to accounts"],
          ["AS / AT", "AllocationReport / AllocationReportAck", "Allocation reporting, common from broker to client"],
          ["AK / AU", "Confirmation / ConfirmationAck", "Trade confirmation workflow"],
          ["AE / AR", "TradeCaptureReport / Ack", "Trade reporting and drop copy of completed trades"],
          ["AD / AQ", "TradeCaptureReportRequest / Ack", "Request a replay of trade capture reports"],
          ["AN / AO / AP", "RequestForPositions / Ack / PositionReport", "Position reporting, common with clearing brokers"],
          ["Q", "DontKnowTrade (DK)", "I do not recognise this trade - a real post-trade break message"],
          ["6 / 7", "IOI / Advertisement", "Indications of interest and advertised trades"]
        ]),
      table("OrdStatus (39) - where the order stands", "State, not event. Read with ExecType.",
        ["Value", "Meaning", "Note"],
        [
          ["0", "New", "Accepted and working"],
          ["1", "Partially filled", "Some quantity done, LeavesQty greater than zero"],
          ["2", "Filled", "Fully executed, LeavesQty zero"],
          ["3", "Done for day", "No longer working today"],
          ["4", "Canceled", "Terminal; unfilled quantity was withdrawn"],
          ["5", "Replaced", "FIX 4.2 status; in 4.4 a replace is signalled by ExecType=5"],
          ["6", "Pending Cancel", "Cancel requested, not yet confirmed - fills can still arrive"],
          ["7", "Stopped", "Guaranteed execution pending"],
          ["8", "Rejected", "Never became a working order - check 103 and 58"],
          ["9", "Suspended", "Held, not working"],
          ["A", "Pending New", "Acknowledged as received, not yet working"],
          ["B", "Calculated", "Average price calculated for allocation"],
          ["C", "Expired", "Time in force elapsed"],
          ["E", "Pending Replace", "Replace requested, not yet confirmed"]
        ]),
      table("ExecType (150) - why this report was sent", "Event, not state. This is the pair interviewers most like to separate.",
        ["Value", "Meaning", "Note"],
        [
          ["0", "New", "The order was accepted"],
          ["4", "Canceled", "The cancel completed"],
          ["5", "Replaced", "The amendment completed"],
          ["6", "Pending Cancel", "Cancel in flight"],
          ["8", "Rejected", "The order or request was rejected"],
          ["A", "Pending New", "Received, not yet working"],
          ["C", "Expired", "Time in force elapsed"],
          ["D", "Restated", "The broker restated the order without a client request"],
          ["E", "Pending Replace", "Replace in flight"],
          ["F", "Trade", "A fill or partial fill - OrdStatus says which"],
          ["G", "Trade Correct", "Corrects an earlier execution, referenced by ExecRefID (19)"],
          ["H", "Trade Cancel", "Busts an earlier execution, referenced by ExecRefID (19)"],
          ["I", "Order Status", "Response to an OrderStatusRequest, not a new event"],
          ["1 / 2", "Partial fill / Fill (FIX 4.2 only)", "Replaced in 4.3 and later by F=Trade with OrdStatus 1 or 2"]
        ]),
      table("Reject reason codes worth recognising", "The first three fields to read on any reject are 58 Text, the reason code, and the referenced message.",
        ["Tag", "Code", "Meaning"],
        [
          ["373 SessionRejectReason", "0 / 1 / 2", "Invalid tag number / required tag missing / tag not defined for this message type"],
          ["373", "5 / 6", "Value out of range for this tag / incorrect data format"],
          ["373", "9", "CompID problem - session identity does not match what the peer expects"],
          ["373", "10", "SendingTime accuracy problem - your clock is outside the peer's tolerance"],
          ["373", "11", "Invalid MsgType"],
          ["373", "13 / 14 / 15 / 16", "Tag appears more than once / tag out of required order / repeating group fields out of order / incorrect NumInGroup count"],
          ["380 BusinessRejectReason", "1 / 2 / 3", "Unknown ID / unknown security / unsupported message type"],
          ["380", "4 / 5 / 6", "Application not available / conditionally required field missing / not authorized"],
          ["103 OrdRejReason", "1 / 2 / 3", "Unknown symbol / exchange closed / order exceeds limit"],
          ["103", "4 / 5 / 6", "Too late to enter / unknown order / duplicate order"],
          ["103", "11 / 13 / 15", "Unsupported order characteristic / incorrect quantity / unknown account"],
          ["102 CxlRejReason", "0 / 1 / 3", "Too late to cancel / unknown order / order already pending cancel or replace"],
          ["102", "6", "Duplicate ClOrdID"]
        ]),
      sample("Worked examples to read aloud", "SOH shown as |. These are the three sequences you should be able to narrate from memory.", [
        ["New order, ack, partial fill, fill",
         "35=D|11=ORD-1042|55=VOD.L|54=1|38=10000|40=2|44=71.25|59=0|21=1|528=A|60=20260914-08:15:03.221|\n35=8|11=ORD-1042|37=BRK-55219|17=E1|150=0|39=0|151=10000|14=0|\n35=8|11=ORD-1042|37=BRK-55219|17=E2|150=F|39=1|32=4000|31=71.24|151=6000|14=4000|6=71.24|30=XLON|\n35=8|11=ORD-1042|37=BRK-55219|17=E3|150=F|39=2|32=6000|31=71.26|151=0|14=10000|6=71.252|30=XLON|",
         "The order is a day limit buy of 10,000. ExecType 0 is the acknowledgement with no quantity done. Each fill carries LastQty and LastPx for that fill only, while CumQty and AvgPx accumulate. LeavesQty reaching 0 with OrdStatus 2 is the terminal state."],
        ["Cancel/replace chain",
         "35=G|11=ORD-1042-R1|41=ORD-1042|37=BRK-55219|38=6000|44=71.20|\n35=8|11=ORD-1042-R1|41=ORD-1042|37=BRK-55219|17=E4|150=E|39=E|\n35=8|11=ORD-1042-R1|37=BRK-55219|17=E5|150=5|39=0|38=6000|44=71.20|151=2000|14=4000|",
         "The replace carries a NEW ClOrdID in 11 and points at the previous one in 41. OrderID (37) does not change. Pending Replace is a real state in which fills can still arrive, which is why the quantity semantics of a replace matter."],
        ["Cancel rejected",
         "35=F|11=ORD-1042-C1|41=ORD-1042-R1|37=BRK-55219|\n35=9|11=ORD-1042-C1|41=ORD-1042-R1|37=BRK-55219|39=2|102=0|434=1|58=Too late to cancel - order fully filled|",
         "A cancel rejection is MsgType 9, not an ExecutionReport. CxlRejResponseTo=1 says it answers a cancel request; 102=0 and the Text say the order had already filled. The position is correct and the client's expectation is not."]
      ]),
      drill("Say it in one sentence", "", [
        ["What is the difference between OrdStatus and ExecType?", "ExecType (150) says why this report was sent - the event, such as an acknowledgement, a fill, a cancel or a rejection. OrdStatus (39) says where the order now stands overall. A single ExecutionReport carries both, so a partial fill is ExecType F with OrdStatus 1."],
        ["What does OrdStatus 6, Pending Cancel, actually mean operationally?", "The cancel has been requested but not confirmed, and the order is still live at the venue. Fills can and do arrive during Pending Cancel, which is why a trader saying 'I cancelled it' does not mean the quantity is safe until a terminal state is received."],
        ["A cancel came back as MsgType 9. What do you tell the trader?", "That the cancel was rejected rather than executed, and the reason from CxlRejReason (102) and the Text (58) - typically that the order was already filled or already terminal. The order state is whatever the last ExecutionReport said, so read that back to them rather than guessing."]
      ])
    ],
    [["FIX Trading Community - message and field reference", "https://www.fixtrading.org/online-specification/"],
     ["FIX 4.2 specification archive", "https://www.fixtrading.org/standards/fix-4-2/"]]);

  /* ------------------------------------------------------------------ */
  section("fixops", "FIX in production: symptoms and evidence",
    "The incidents you will actually be handed, and what proves each one",
    [
      table("Symptom to cause to evidence", "This table is the interview answer to 'a client says their orders are not working'.",
        ["Symptom", "Likely cause", "Evidence that proves it"],
        [
          ["Session will not log on", "Wrong CompIDs, wrong port or host, session outside its schedule, IP not permitted, already connected elsewhere, FIX version mismatch", "Logout Text (58), engine log, configured SenderCompID/TargetCompID and BeginString, session schedule, TCP connect result"],
          ["Session drops repeatedly", "Heartbeat not answered, network path instability, peer restarting, duplicate connection from a second instance", "TestRequest/Heartbeat 112 correlation, TCP counters and retransmissions, peer disconnect reasons, connection counts"],
          ["MsgSeqNum too high", "Messages missing - a genuine gap", "ResendRequest issued and the replay that follows; message store contents around the gap"],
          ["MsgSeqNum too low", "Peer reset or lost its store, or you are connected to a different instance", "Peer confirmation of what they did; both stores; the last agreed sequence numbers"],
          ["Rejects with 373=10", "SendingTime outside the peer's tolerance - clock skew", "Time source state (chrony or PTP), offset history, reject Text; compare 52 against local receive time"],
          ["Rejects with 373=9", "CompID problem - identity mismatch", "Configured identities versus the values in 49 and 56 on the rejected message"],
          ["CheckSum or BodyLength errors", "Truncated or corrupted frames, middlebox interference, or a bad encoder", "Raw captured bytes, the message as stored, network path between the two sides"],
          ["Orders acked but never filled", "Order is working and the market has not traded there - not a fault", "Last ExecutionReport, OrdStatus and LeavesQty, market data at the limit price"],
          ["Duplicate fills downstream", "Replay applied twice: PossDupFlag or PossResend not handled, or dedupe key wrong", "ExecIDs on both sides; 43 and 97 flags; the consumer dedupe key and checkpoint"],
          ["Missing fills downstream", "Consumer lag, a dropped mapping, or a drop copy that does not include that source session", "Session sequence versus consumer checkpoint; drop copy entitlement and source-session mapping"],
          ["Drop copy healthy but incomplete", "Transport works, source mapping does not", "Compare executions per source session between the trading sessions and the drop copy"],
          ["Venue throttling or rejecting on rate", "Message rate budget exceeded, often by one strategy", "Per-session and per-strategy message counts against the venue limit; venue reject Text"]
        ]),
      terms("Evidence discipline in a FIX incident", "This is what separates a support engineer from someone who restarts things.", [
        ["Preserve before repair", "Copy the message store, logs and configuration before changing anything.", "Sequence recovery and later dispute resolution both depend on the state you are about to overwrite."],
        ["Separate transport, session and business", "Is TCP connected? Is the session logged on and sequenced? Is the business message accepted?", "Each layer has different evidence and a different owner. Saying which layer failed is half the answer."],
        ["Prove with identifiers, not impressions", "Trace a specific ClOrdID or ExecID through every hop rather than describing volumes.", "'The order is missing' is a claim; 'ORD-1042 is present on the session at 08:15:03 and absent from the booking inbox' is evidence."],
        ["Coordinate before resetting", "Sequence resets, store changes and replays are bilateral actions.", "A unilateral reset can make the counterparty's records irreconcilable with yours."],
        ["Reconcile after recovery", "After a session recovers, compare orders and executions, not just session state.", "A logged-on session is not proof that the business caught up. Check CumQty, LeavesQty and execution counts per order."],
        ["Idempotent replay", "Replay into downstream systems using the business key so a repeat is harmless.", "Deduplicating on ExecID is what makes a replay safe to run twice under pressure."]
      ]),
      terms("Engine configuration vocabulary (QuickFIX/J style)", "Useful because so many banks run QuickFIX/J or a system with the same concepts.", [
        ["BeginString / SenderCompID / TargetCompID", "The three values that identify the session and select its message store.", "Changing any of them points the engine at a different session identity - and a different store."],
        ["FileStorePath / persistence", "Where sequence numbers and outbound messages are kept.", "The store is the recovery asset. Know where it is before you need it."],
        ["ResetOnLogon / ResetOnLogout / ResetOnDisconnect", "Whether sequence counters reset at those points.", "ResetOnLogon=Y during trading hides gaps rather than fixing them. Changing it is a controlled configuration change."],
        ["HeartBtInt", "The agreed heartbeat interval in seconds.", "Must match what the counterparty expects, and drives how quickly a dead session is detected."],
        ["StartTime / EndTime", "The daily session schedule.", "Outside the window, a logon is refused by design."],
        ["DataDictionary / UseDataDictionary", "Which XML dictionary validates messages.", "A venue-specific dictionary mismatch shows as rejects on messages the venue considers valid."],
        ["ReconnectInterval / LogonTimeout", "Reconnection behaviour after a drop.", "Aggressive reconnection against a venue that is rate limiting makes the outage worse."],
        ["Edited on disk vs loaded in the engine", "A configuration file change does not take effect until the engine loads it.", "State explicitly which you did. This distinction is the point of most FIX configuration interview questions."]
      ]),
      sample("Reading FIX logs on a Linux box", "The SOH delimiter is what makes this different from ordinary grepping.", [
        ["Find one order and its whole life",
         "grep -F \"11=ORD-1042|\" /var/log/fix/messages.log\ngrep -F \"37=BRK-55219|\" /var/log/fix/messages.log | head -40",
         "Include the delimiter in the pattern. Without it, 11=ORD-104 also matches ORD-1042 and ORD-10420."],
        ["Count executions and spot duplicates",
         "grep -F \"35=8|\" /var/log/fix/messages.log | grep -o \"17=[^|]*\" | sort | uniq -d",
         "Any ExecID appearing twice is either a legitimate replay flagged with 43=Y or a genuine duplicate to investigate downstream."],
        ["Isolate session problems from business problems",
         "grep -E \"\\|35=(3|5|A|2|4)\\|\" /var/log/fix/messages.log | tail -50\ngrep -F \"373=\" /var/log/fix/messages.log | grep -o \"373=[0-9]*\" | sort | uniq -c",
         "The first line shows session-level traffic only. The second counts session reject reasons so you can see whether one cause dominates."],
        ["Check quantities on an order",
         "grep -F \"11=ORD-1042|\" /var/log/fix/messages.log | grep -o \"|1[45]1\\?=[0-9]*\" | tail",
         "Reading CumQty (14) and LeavesQty (151) in sequence tells you whether the order progressed as the venue reported."]
      ]),
      drill("Say it in one sentence", "", [
        ["A client says orders are not reaching the market. How do you investigate?", "Take one ClOrdID and follow it. Confirm it left the OMS, appears outbound on the FIX session log with a sequence number, that the session is logged on and sequences are advancing, and whether an ExecutionReport or Reject came back. If the order never appears outbound it is an upstream or routing problem; if it appears and is rejected, read tag 58 and the reason code; if it appears with no response, prove session liveness with heartbeats and, if necessary, an OrderStatusRequest before calling the venue."],
        ["The FIX session is up but no business messages are flowing. What does that tell you?", "The transport and session layers are healthy, so the problem is upstream of the session or on the business side: nothing is being sent, an application component is not producing messages, or the peer has stopped sending. Prove the session is alive with heartbeat and test request traffic, then look at the producing application and the business message queues rather than the connection."],
        ["What is your approach to a sequence gap?", "Let the engine do what the protocol designed it to do: detect the gap and issue a ResendRequest, then verify the replay arrives with PossDupFlag set and the original send times in tag 122. Preserve the store and logs first, confirm with the counterparty what they believe they sent, and after the session is back check the business result - orders and executions reconciled - not just the sequence numbers."]
      ])
    ],
    [["QuickFIX/J configuration reference", "https://www.quickfixj.org/usermanual/"],
     ["FIX Trading Community - session protocol", "https://www.fixtrading.org/standards/"]]);

  /* ------------------------------------------------------------------ */
  section("quickfire", "Rapid-fire interview answers",
    "The cross-cutting questions that decide whether they think you understand the business",
    [
      drill("Product understanding", "", [
        ["What is a derivative?", "A contract whose value comes from something else - a share, an index, a rate, a currency or a commodity - rather than from owning that thing. It lets a user take, transfer or hedge exposure without holding the underlying, and it is why one trade can depend on five separate data feeds."],
        ["Forward, future, option, swap - one line each.", "A forward is a bilateral agreement to trade later at a price agreed now. A future is the standardised, exchange-traded, daily-margined version of the same thing. An option gives the buyer the right but not the obligation to trade at a strike, for a premium. A swap is an exchange of cash flow streams over time, such as fixed interest for floating."],
        ["Why would a fund use a total return swap instead of buying the stock?", "To get the economic return without holding the asset: leverage, access to markets where direct ownership is restricted or expensive, balance sheet and financing efficiency, and sometimes disclosure treatment. The cost is financing plus a spread, and the fund takes counterparty risk on the bank."],
        ["What is the difference between notional and market value?", "Notional is the contract size the exposure is calculated on. Market value is what the contract is currently worth. A swap can have a billion of notional and almost no market value at inception, which is why risk limits are usually expressed in notional or sensitivities rather than value."],
        ["What makes an OTC trade operationally harder than a listed one?", "There is no exchange or clearing house producing an authoritative record, so both sides rely on their own booking, on confirmation and affirmation to agree terms, on bilateral collateral instead of CCP margin, and on internal marks instead of settlement prices. Every one of those is a place for the two records to diverge."]
      ]),
      drill("Support judgement", "", [
        ["What is the first thing you do when paged?", "Establish impact and deadline before cause: what business function is affected, how many trades or clients, and what cutoff is at risk. That decides severity, who to bring in and how much investigation time you actually have."],
        ["A batch job succeeded but the numbers are wrong. What now?", "Treat the exit code as irrelevant. Verify the business output against its inputs - row counts, control totals, position and PnL movement against expectation - then trace back to the first input that is stale, missing or unexpected. A successful job with wrong inputs is the most common shape of an EOD incident."],
        ["When do you escalate rather than keep investigating?", "When the deadline, not the difficulty, says so: if the time remaining before a cutoff is less than the time you can honestly promise to a fix, escalate now and continue in parallel. Also escalate immediately for anything client-visible, anything with a regulatory deadline, and anything where the safe recovery needs an approval you do not hold."],
        ["How do you handle a fix that needs a data change in production?", "Through the firm's controlled process: identify the authoritative system, get the business owner's approval for the specific change, capture before and after evidence, apply the smallest scoped change, then verify the business result and record it. Repairing a downstream copy instead of the golden source, or editing without a trail, turns an incident into an audit finding."],
        ["How do you communicate during a P1?", "In business terms on a fixed cadence: what is impacted, what the deadline is, what has been ruled out, what is being done now, and the next update time. Technical detail belongs in the investigation channel; the bridge needs impact, plan and time."],
        ["What makes a good handover between regions?", "The incident as a narrative, not a log dump: the impact, the timeline, what has been proved and ruled out, the current hypothesis, what was changed and by whom, what is safe to restart, and who is waiting for an answer. Anything reversed or still pending must be explicit."]
      ]),
      drill("Where product knowledge meets Linux", "These are the crossover questions that this simulator's incidents are built around.", [
        ["Why would a clock problem stop trading?", "Because venues reject messages whose SendingTime is outside their tolerance, and regulation requires business clocks to track UTC within a defined limit. A lost PTP source with NTP fallback drifting is both a connectivity incident (rejected orders) and a compliance one, and stepping a trading host's clock forward during the session can be worse than the drift itself."],
        ["Why does a disk full incident become a trading incident?", "Because FIX message stores, trade capture logs and batch outputs stop being written. The application often keeps running while silently failing to persist, so you lose the recovery evidence and the business record, and recovery has to preserve what is still open rather than simply deleting files."],
        ["Why does memory pressure on a tick database have a deadline?", "The realtime database holds the day in memory and writes it down overnight. If the writedown failed, it is carrying two days and will not survive to the next close, so the deadline is the market open or the close, not whenever the box runs out."],
        ["A consumer is behind on a market data feed. Is that data loss?", "Not necessarily - it can be legitimate conflation or a slow consumer catching up. Data loss means packets did not arrive or a gap was never recovered. Separate arrival at the interface from delivery to the application before you use the words 'data loss' on a bridge."]
      ])
    ],
    [["FIX Trading Community", "https://www.fixtrading.org/"],
     ["ISDA", "https://www.isda.org/"]]);

  PS.vocabEntryCount = PS.vocabSections.reduce(function (total, s) {
    return total + s.blocks.reduce(function (n, b) { return n + b.rows.length; }, 0);
  }, 0);
})(PS);
