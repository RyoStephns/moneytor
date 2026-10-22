import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { onLink } from "../router";
import { usePageTitle } from "../ui";

type PayPeriod = { id: number; period_start: string; period_end: string | null; status: string; days_elapsed: number; days_total: number | null };
type Account = { name: string; type: string; balance: number; is_default: boolean };
type Context = {
  current_period: PayPeriod | null;
  pay_periods: PayPeriod[];
  accounts: { accounts: Account[]; total_balance: number; unknown_account: { balance: number; transaction_count: number } };
};
// mysql2 hands DECIMAL sums back as strings, and the API passes them through untouched
type Row = { type: "income" | "expense"; total: string | number; transaction_count: number };
type Summary = {
  totals: { income: number; expense: number; net: number; transaction_count: number };
  by_category: (Row & { category: string })[];
  by_account: (Row & { account: string })[];
  by_period: (Row & { period: string })[];
};
type Averages = { period_count: number; average_income: number; average_expense: number; average_net: number; by_period: { period: string; income: number; expense: number; net: number }[] };
type Baseline = { period_start: string; period_end: string; pay_periods: number; summary: Summary };
type TrendRow = { id: number; period_start: string; period_end: string | null; totals: Summary["totals"] };
type Numbers = { summary: Summary; averages: Averages; history: Summary; baseline: Baseline | null; trend: TrendRow[] };
// days: how much of the range has happened so far; live: today falls inside it
type Range = { start: string; end: string | null; days: number; axisDays: number; label: string; live: boolean };

const MONTH_DAYS = 365.25 / 12;
const TOP_CATEGORIES = 8;

const whole = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
// rupiah amounts are almost always whole; when one isn't, show both decimals rather than ",7"
const money = (n: number, sign = false) => {
  const abs = Math.round(Math.abs(n) * 100) / 100;
  const txt = (abs % 1 ? cents : whole).format(abs).replace(/\s/g, "\u00a0");
  return `${n < 0 && abs > 0 ? "−" : sign && n > 0 ? "+" : ""}${txt}`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}`;
const monthName = { format: (d: Date) => `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
const today = () => new Date().toLocaleDateString("en-CA");
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;

function rangeFor(choice: string, ctx: Context, custom: { start: string; end: string }): Range {
  const now = today();
  const fit = (start: string, end: string | null, label: string): Range => {
    const last = end && end < now ? end : now;
    const days = start > now ? 0 : span(start, last);
    // an open pay period has no end yet, so the chart leaves room for a usual month
    const axisDays = end ? span(start, end) : Math.max(days, Math.round(MONTH_DAYS));
    return { start, end, days: Math.min(days, axisDays), axisDays, label, live: start <= now && (!end || end >= now) };
  };
  if (choice === "month") {
    const start = now.slice(0, 8) + "01";
    const end = addDays(new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7), 1)).toISOString().slice(0, 10), -1);
    return fit(start, end, `${monthName.format(new Date(start + "T00:00:00Z"))}`);
  }
  if (choice === "custom") return fit(custom.start, custom.end, `${day(custom.start)} – ${day(custom.end)}`);
  const p = ctx.pay_periods.find((x) => `p${x.id}` === choice) ?? ctx.current_period!;
  return fit(p.period_start, p.period_end, p.period_end ? `${day(p.period_start)} – ${day(p.period_end)}` : `${day(p.period_start)} – today`);
}

function expenseByCategory(s: Summary) {
  const m = new Map<string, number>();
  for (const r of s.by_category) if (r.type === "expense") m.set(r.category, (m.get(r.category) ?? 0) + Number(r.total));
  return m;
}

// What "usual" means: daily rates from the closed pay periods, because a salary paid on the
// 28th makes calendar months lopsided. Without a closed period, fall back to get_averages.
type Yardstick = { inPerDay: number; outPerDay: number; outPerDayFor: (cat: string) => number; perIn: number; perOut: number; unit: string; basis: string };

function yardstick(n: Numbers): Yardstick | null {
  if (n.baseline) {
    const { period_start, period_end, pay_periods: k, summary } = n.baseline;
    const days = span(period_start, period_end);
    const cats = expenseByCategory(summary);
    return {
      inPerDay: summary.totals.income / days,
      outPerDay: summary.totals.expense / days,
      outPerDayFor: (cat) => (cats.get(cat) ?? 0) / days,
      perIn: summary.totals.income / k,
      perOut: summary.totals.expense / k,
      unit: "pay period",
      basis: `${plural(k, "closed pay period")}, ${day(period_start)} – ${day(period_end)}`,
    };
  }
  const a = n.averages;
  if (!a.period_count) return null;
  const cats = expenseByCategory(n.history);
  return {
    inPerDay: a.average_income / MONTH_DAYS,
    outPerDay: a.average_expense / MONTH_DAYS,
    outPerDayFor: (cat) => (cats.get(cat) ?? 0) / a.period_count / MONTH_DAYS,
    perIn: a.average_income,
    perOut: a.average_expense,
    unit: "month",
    basis: `${plural(a.period_count, "calendar month")} since ${monthName.format(new Date(a.by_period[0].period + "-01T00:00:00Z"))}`,
  };
}

export function DashboardPage() {
  usePageTitle("Dashboard");
  const [ctx, setCtx] = useState<Context | null>(null);
  const [choice, setChoice] = useState("");
  const [account, setAccount] = useState("");
  const [custom, setCustom] = useState({ start: today().slice(0, 8) + "01", end: today() });
  const [nums, setNums] = useState<Numbers | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<Context>("/dashboard/context")
      .then((c) => {
        setCtx(c);
        setChoice(c.current_period ? `p${c.current_period.id}` : "month");
      })
      .catch(() => setFailed(true));
  }, []);

  const badCustom = choice === "custom" && (!custom.start || !custom.end || custom.start > custom.end);
  const range = useMemo(() => (ctx && choice && !badCustom ? rangeFor(choice, ctx, custom) : null), [ctx, choice, custom, badCustom]);

  useEffect(() => {
    if (!range || badCustom) return;
    const q = new URLSearchParams({ start_date: range.start, period: "day" });
    if (range.end) q.set("end_date", range.end);
    if (account) q.set("account", account);
    let live = true;
    setNums(null);
    api<Numbers>(`/dashboard/summary?${q}`)
      .then((n) => live && setNums(n))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [range, account, badCustom]);

  if (failed) {
    return (
      <div className="page">
        <header><h1 className="display">Your money</h1></header>
        <div className="notice"><p>We couldn't load your numbers. Reload the page to try again.</p></div>
      </div>
    );
  }

  const nothingYet = nums && nums.averages.period_count === 0 && ctx?.accounts.accounts.length === 0;
  if (nothingYet) return <EmptyDashboard />;

  const current = ctx?.current_period && choice === `p${ctx.current_period.id}`;

  return (
    <div className="page dash">
      <aside className="dash-side">
        <header>
          <h1 className="display">Your money</h1>
          <p className="lede">
            {badCustom ? "Pick the dates to show." : range ? <>{current ? "Current pay period" : "Showing"} {range.label}{range.live ? `, day ${range.days}` : ""}.</> : <span className="skeleton" style={{ display: "block", width: "60%" }} />}
          </p>
        </header>

        <div className="filters">
          <div className="field">
            <label htmlFor="period">Period</label>
            <select id="period" className="input" value={choice} disabled={!ctx} onChange={(e) => setChoice(e.target.value)}>
              {ctx?.current_period && <option value={`p${ctx.current_period.id}`}>Current pay period</option>}
              {ctx?.pay_periods.filter((p) => p.id !== ctx.current_period?.id).slice(0, 12).map((p) => (
                <option key={p.id} value={`p${p.id}`}>Pay period {day(p.period_start)} – {p.period_end ? day(p.period_end) : "open"}</option>
              ))}
              <option value="month">This calendar month</option>
              <option value="custom">Choose dates…</option>
            </select>
          </div>
          {choice === "custom" && (
            <div className="dates">
              {badCustom && <p className="error" id="dates-error"><i className="err-mark" aria-hidden="true" /><span><span className="visually-hidden">Error: </span>The start date has to be on or before the end date.</span></p>}
              <div className={`field${badCustom ? " invalid" : ""}`}>
                <label htmlFor="from">From</label>
                <input id="from" type="date" className="input" value={custom.start} max={custom.end} aria-invalid={badCustom || undefined} aria-describedby={badCustom ? "dates-error" : undefined} onChange={(e) => setCustom({ ...custom, start: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="to">To</label>
                <input id="to" type="date" className="input" value={custom.end} min={custom.start} onChange={(e) => setCustom({ ...custom, end: e.target.value })} />
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="account">Account</label>
            <select id="account" className="input" value={account} disabled={!ctx} onChange={(e) => setAccount(e.target.value)}>
              <option value="">All accounts</option>
              {ctx?.accounts.accounts.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
        </div>

        {!badCustom && <PeriodRecord nums={nums} ctx={ctx} range={range} account={account} />}
      </aside>

      {badCustom ? (
        <div className="dash-main">
          <div className="notice"><p>Nothing to show for these dates. Set From on or before To and the numbers come back.</p></div>
        </div>
      ) : (
        <div className="dash-main" aria-busy={!nums || undefined}>
          <Pace nums={nums} range={range} />
          <WhereItWent nums={nums} range={range} />
          <Accounts nums={nums} ctx={ctx} account={account} />
          <Months nums={nums} />
        </div>
      )}
    </div>
  );
}

function PeriodRecord({ nums, ctx, range, account }: { nums: Numbers | null; ctx: Context | null; range: Range | null; account: string }) {
  if (!nums || !ctx || !range) return <section className="sheet stacked"><Skeletons n={4} /></section>;
  const { totals } = nums.summary;
  const yard = yardstick(nums);
  // a range that hasn't started has no "usual" to compare against
  const usual = yard && range.days > 0 ? yard : null;
  return (
    <section className="sheet stacked" aria-labelledby="period-title">
      <h2 className="title record-title" id="period-title">This period</h2>
      <div className="keyfig">
        <span className="legend">Net</span>
        <span className="figure">{money(totals.net, true)}</span>
        {usual && <span className="note">usual for {range.days} days: <span className="money">{money((usual.inPerDay - usual.outPerDay) * range.days, true)}</span></span>}
      </div>
      <table className="record figures">
        <tbody>
          <tr>
            <th scope="row">Income</th>
            <td className="num"><span className="money">{money(totals.income)}</span>{usual && <span className="note">usual <span className="money">{money(usual.inPerDay * range.days)}</span></span>}</td>
          </tr>
          <tr>
            <th scope="row">Expense</th>
            <td className="num"><span className="money">{money(-totals.expense)}</span>{usual && <span className="note">usual <span className="money">{money(-usual.outPerDay * range.days)}</span></span>}</td>
          </tr>
          <tr>
            <th scope="row">Balance now</th>
            <td className="num"><span className="money">{money(ctx.accounts.total_balance)}</span><span className="note">{account ? "all accounts, not filtered" : plural(ctx.accounts.accounts.length, "account")}</span></td>
          </tr>
          {yard ? (
            <>
              <tr>
                <th scope="row">Avg in</th>
                <td className="num plain"><span className="money">{money(yard.perIn)}</span><span className="note">a {yard.unit}</span></td>
              </tr>
              <tr>
                <th scope="row">Avg out</th>
                <td className="num plain"><span className="money">{money(-yard.perOut)}</span><span className="note">a {yard.unit}, from {yard.basis}</span></td>
              </tr>
            </>
          ) : (
            <tr>
              <th scope="row">Average</th>
              <td className="num plain">Not enough history yet</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="small muted record-foot">
        {plural(totals.transaction_count, "transaction")} in this period.
        {usual && ` "Usual" is what you typically take in and spend per day ${yard!.unit === "pay period" ? "in your closed pay periods" : "in an average month"}, times ${range.days} days.`}
      </p>
    </section>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Pace({ nums, range }: { nums: Numbers | null; range: Range | null }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const ready = nums && range;
  const daily = new Map<string, number>();
  if (ready) for (const r of nums.summary.by_period) if (r.type === "expense") daily.set(r.period, (daily.get(r.period) ?? 0) + Number(r.total));

  const steps: { x: number; y: number }[] = [];
  let run = 0;
  if (ready) {
    for (let i = 0; i < range.days; i++) {
      run += daily.get(addDays(range.start, i)) ?? 0;
      steps.push({ x: i + 1, y: run });
    }
  }
  const yard = ready ? yardstick(nums) : null;
  const perDay = yard?.outPerDay ?? 0;
  const usualToday = perDay * (range?.days ?? 0);
  const top = Math.max(run, perDay * (range?.axisDays ?? 0), 1);
  const ahead = usualToday > 0 ? run / usualToday - 1 : null;
  const open = range?.live;

  const h = 220, padL = 8, padR = 8, padT = 28, padB = 26;
  const W = Math.max(width, 280);
  const x = (d: number) => padL + (d / (range?.axisDays || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / top) * (h - padT - padB);
  const path = steps.reduce((acc, s, i) => acc + `H${x(s.x - 1).toFixed(1)}V${y(s.y).toFixed(1)}` + (i === steps.length - 1 ? `H${x(s.x).toFixed(1)}` : ""), `M${x(0)} ${y(0)}`);
  const tx = range ? x(range.days) : 0;

  let headline = "Spending pace";
  if (ready && ahead !== null && yard) {
    const pct = Math.round(Math.abs(ahead) * 100);
    headline = pct < 3 ? "Spending at your usual pace" : `Spending ${pct}% ${ahead > 0 ? "above" : "under"} your usual pace`;
  }

  return (
    <section className="sheet" aria-labelledby="pace-title">
      <div className="section-head">
        <h2 className="title" id="pace-title">{headline}</h2>
        <p className="small muted">
          Running total of expense. Dashed line: your usual daily spend{yard?.unit === "pay period" ? " in closed pay periods" : " in an average month"}
          {ready && perDay > 0 ? <>; by {day(addDays(range.start, range.axisDays - 1))} that's <span className="nowrap">{money(-perDay * range.axisDays)}</span>.</> : "."}
        </p>
      </div>
      <div ref={box} className="chart">
        {!ready || width === 0 ? <div className="skeleton" style={{ height: h }} /> : (
          <svg width={W} height={h} role="img" aria-label={`Expense so far ${money(run)}; usual by now ${money(usualToday)}.`}>
            <line className="axis" x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} />
            <line className="avg" x1={x(0)} y1={y(0)} x2={x(range.axisDays)} y2={y(perDay * range.axisDays)} />
            <path className="run" d={path} />
            {open && (
              <g className="today">
                <line x1={tx} x2={tx} y1={padT - 10} y2={y(0)} />
                <text x={tx > W - 200 ? tx - 6 : tx + 6} y={padT - 2} textAnchor={tx > W - 200 ? "end" : "start"}>Today {money(run)}</text>
              </g>
            )}
            <text className="tick" x={padL} y={h - 6}>{day(range.start)}</text>
            <text className="tick" x={W - padR} y={h - 6} textAnchor="end">{day(addDays(range.start, range.axisDays - 1))}{range.end ? "" : " (est.)"}</text>
          </svg>
        )}
      </div>
    </section>
  );
}

function WhereItWent({ nums, range }: { nums: Numbers | null; range: Range | null }) {
  if (!nums || !range) return <section className="sheet"><h2 className="title">Where it went</h2><Skeletons n={5} /></section>;
  const { income, expense, net } = nums.summary.totals;
  const spent = [...expenseByCategory(nums.summary)].sort((a, b) => b[1] - a[1]);
  const yard = range.days > 0 ? yardstick(nums) : null;
  const compared = Boolean(yard);
  const usual = (cat: string) => (yard ? yard.outPerDayFor(cat) * range.days : 0);

  const shown = spent.slice(0, TOP_CATEGORIES);
  const rest = spent.slice(TOP_CATEGORIES);
  const rows = shown.map(([cat, amt]) => ({ cat, amt, avg: usual(cat) }));
  if (rest.length) rows.push({ cat: `Other (${rest.length})`, amt: rest.reduce((s, r) => s + r[1], 0), avg: rest.reduce((s, r) => s + usual(r[0]), 0) });

  // the scale runs from the lowest point the steps reach up to income, so an overspent period dips below zero
  const lo = Math.min(0, net);
  const hi = Math.max(income, expense, 1);
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const worst = rows.reduce<{ cat: string; over: number } | null>((w, r) => {
    const over = r.avg > 0 ? r.amt / r.avg - 1 : 0;
    return over > 0.1 && (!w || over > w.over) ? { cat: r.cat, over } : w;
  }, null);

  let left = income;
  return (
    <section className="sheet" aria-labelledby="where-title">
      <div className="section-head">
        <h2 className="title" id="where-title">Where it went</h2>
        {compared && <p className="small muted">Tick and %: compared with what you usually spend on it in {range.days} days.</p>}
      </div>
      {expense === 0 && income === 0 ? <p className="empty">Nothing recorded in this period{range.end ? "" : " yet"}.</p> : (
        <ol className="steps-down">
          <li className="step head" aria-hidden="true">
            <span className="legend">Category</span>
            <span />
            <span className="legend amt">This period</span>
            <span className="legend dev">vs usual</span>
          </li>
          <li className="step">
            <span className="legend">Income</span>
            <span className="track"><i className="in" style={{ left: `${pos(0)}%`, width: `${pos(income) - pos(0)}%` }} /></span>
            <span className="amt">{money(income)}</span>
            <span className="dev" />
          </li>
          {rows.map((r) => {
            const from = left;
            left -= r.amt;
            const dev = r.avg > 0 ? Math.round((r.amt / r.avg - 1) * 100) : null;
            return (
              <li key={r.cat} className={`step${worst?.cat === r.cat ? " key" : ""}`}>
                <span className="legend">{r.cat}</span>
                <span className="track">
                  <i className="out" style={{ left: `${pos(left)}%`, width: `${Math.max(pos(from) - pos(left), 0.4)}%` }} />
                  {r.avg > 0 && <u style={{ left: `${Math.max(0, pos(from - r.avg))}%` }} aria-hidden="true" />}
                </span>
                <span className="amt">{money(-r.amt)}</span>
                <span className="dev">{dev === null ? (compared ? "new" : "") : `${dev > 0 ? "+" : dev < 0 ? "−" : ""}${Math.abs(dev)}%`}</span>
              </li>
            );
          })}
          <li className="step total">
            <span className="legend">{net < 0 ? "Overspent" : "Net left"}</span>
            <span className="track"><i className={net < 0 ? "out" : "in"} style={{ left: `${pos(Math.min(0, net))}%`, width: `${Math.abs(pos(net) - pos(0))}%` }} /></span>
            <span className="amt">{money(net, true)}</span>
            <span className="dev" />
          </li>
        </ol>
      )}
      {worst && <p className="small record-foot">{worst.cat} is furthest above your usual: {Math.round(worst.over * 100)}% more than an average {range.days} days.</p>}
    </section>
  );
}

function Accounts({ nums, ctx, account }: { nums: Numbers | null; ctx: Context | null; account: string }) {
  if (!nums || !ctx) return <section className="sheet"><h2 className="title">Accounts</h2><Skeletons n={3} /></section>;
  const flow = new Map<string, { in: number; out: number }>();
  for (const r of nums.summary.by_account) {
    const f = flow.get(r.account) ?? { in: 0, out: 0 };
    f[r.type === "income" ? "in" : "out"] += Number(r.total);
    flow.set(r.account, f);
  }
  const { accounts, total_balance, unknown_account } = ctx.accounts;
  return (
    <section className="sheet" aria-labelledby="accounts-title">
      <div className="section-head">
        <h2 className="title" id="accounts-title">Accounts</h2>
        <p className="small muted">In and out for this period; balance is right now.</p>
      </div>
      {accounts.length === 0 ? <p className="empty">No accounts yet. Ask your assistant to add one, for example "add my BCA account".</p> : (
        <div className="table-wrap">
          <table className="record cards-sm labelled">
            <thead><tr><th scope="col" className="legend">Account</th><th scope="col" className="legend num">In</th><th scope="col" className="legend num">Out</th><th scope="col" className="legend num">Balance</th></tr></thead>
            <tbody>
              {accounts.map((a) => {
                const f = flow.get(a.name);
                const dim = account && account !== a.name;
                return (
                  <tr key={a.name} className={dim ? "dim" : undefined}>
                    <td data-label="Account"><span>{a.name}{a.is_default && <span className="note">default</span>}</span></td>
                    <td data-label="In" className="num plain">{f?.in ? money(f.in) : "—"}</td>
                    <td data-label="Out" className="num plain">{f?.out ? money(-f.out) : "—"}</td>
                    <td data-label="Balance" className="num">{money(a.balance)}</td>
                  </tr>
                );
              })}
              <tr className="sum"><td data-label="Account">Total</td><td colSpan={2} /><td data-label="Balance" className="num">{money(total_balance)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {unknown_account.transaction_count > 0 && (
        <p className="small muted record-foot">Older history with no account ({plural(unknown_account.transaction_count, "transaction")}, {money(unknown_account.balance, true)}) is kept for reference and isn't part of the total.</p>
      )}
    </section>
  );
}

function Months({ nums }: { nums: Numbers | null }) {
  if (!nums) return <section className="sheet"><h2 className="title">Over time</h2><Skeletons n={4} /></section>;
  // pay periods when there are any, so a salary sits beside what it paid for; calendar months otherwise
  const byPay = nums.trend.length > 0;
  const rows = byPay
    ? nums.trend.map((p) => ({
        key: String(p.id),
        label: p.period_end ? `${day(p.period_start)} – ${day(p.period_end)}` : `${day(p.period_start)} – today`,
        income: p.totals.income,
        expense: p.totals.expense,
        net: p.totals.net,
      }))
    : nums.averages.by_period.slice(-6).reverse().map((r) => ({ key: r.period, label: monthName.format(new Date(r.period + "-01T00:00:00Z")), ...r }));
  if (!rows.length) return null;
  const top = Math.max(...rows.flatMap((r) => [r.income, r.expense]), 1);
  const unit = byPay ? "Pay period" : "Month";
  return (
    <section className="sheet" aria-labelledby="months-title">
      <div className="section-head">
        <h2 className="title" id="months-title">{byPay ? "Pay period by pay period" : "Month by month"}</h2>
        <p className="small muted">{byPay ? "Your pay periods, newest first." : "Calendar months, newest first."}</p>
      </div>
      <div className="table-wrap">
        <table className="record cards-sm labelled months">
          <thead><tr><th scope="col" className="legend">{unit}</th><th scope="col" className="legend">In and out</th><th scope="col" className="legend num">Net</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td data-label={unit}>{r.label}</td>
                <td data-label="In and out" className="plain">
                  <span className="pair"><i className="in" style={{ width: `${(r.income / top) * 100}%` }} /><span>{money(r.income)}</span></span>
                  <span className="pair"><i className="out" style={{ width: `${(r.expense / top) * 100}%` }} /><span>{money(-r.expense)}</span></span>
                </td>
                <td data-label="Net" className="num">{money(r.net, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Skeletons({ n }: { n: number }) {
  return <div className="skeletons" role="status">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" />)}<span className="visually-hidden">Loading</span></div>;
}

function EmptyDashboard() {
  return (
    <div className="page">
      <header>
        <h1 className="display">Your money</h1>
        <p className="lede">Nothing is recorded yet. Your income, spending and accounts appear here once you start.</p>
      </header>
      <section className="sheet stacked" aria-labelledby="start-title">
        <h2 className="title record-title" id="start-title">Get started</h2>
        <ol className="steps">
          <li><div>Connect Claude or Gemini to Moneytor. The steps are on <a href="/account" onClick={onLink("/account")}>your account page</a>.</div></li>
          <li><div>Tell it about your accounts, for example "I have BCA with Rp&nbsp;5.000.000 and cash Rp&nbsp;300.000".</div></li>
          <li><div>Record what comes in and goes out, like "spent 45k on lunch". This page fills in as you go.</div></li>
        </ol>
      </section>
    </div>
  );
}
