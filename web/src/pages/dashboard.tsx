import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
type Group = { group_id: number; name: string; budget_type: "spending" | "saving"; categories: string[]; budget_amount: number; actual_amount: number; pct_used: number };
type Budget = {
  period_info: { total_budget_spending: number; total_actual: number; total_remaining: number };
  groups: Group[];
  unbudgeted: { categories: { category: string; amount: number }[]; total_amount: number };
};
type Numbers = { summary: Summary; averages: Averages; history: Summary; baseline: Baseline | null; trend: TrendRow[]; budget: Budget | null };
type Txn = { id: number; amount: string; description: string | null; occurred_at: string; account: string | null };
// days: how much of the range has happened so far; live: today falls inside it
type Range = { start: string; end: string | null; days: number; axisDays: number; label: string; live: boolean; payPeriod: number | null };

const MONTH_DAYS = 365.25 / 12;

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
// whole rupiah: cents are noise on a page read at a glance
const money = (n: number, sign = false) => {
  const abs = Math.round(Math.abs(n));
  const txt = rupiah.format(abs).replace(/\s/g, " ");
  return `${n < 0 && abs > 0 ? "−" : sign && n > 0 ? "+" : ""}${txt}`;
};
// estimates get rounded to the thousand and marked, so they don't pass for recorded amounts
// (rounded on the size, since Math.round takes -38.5 to -38 but 38.5 to 39)
const approx = (n: number, sign = false) => `≈ ${money(Math.sign(n) * Math.round(Math.abs(n) / 1000) * 1000, sign)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}`;
const monthName = { format: (d: Date) => `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
const today = () => new Date().toLocaleDateString("en-CA");
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;

function rangeFor(choice: string, ctx: Context, custom: { start: string; end: string }): Range {
  const now = today();
  const fit = (start: string, end: string | null, label: string, payPeriod: number | null = null): Range => {
    const last = end && end < now ? end : now;
    const days = start > now ? 0 : span(start, last);
    // an open pay period has no end yet, so the chart leaves room for a usual month
    const axisDays = end ? span(start, end) : Math.max(days, Math.round(MONTH_DAYS));
    return { start, end, days: Math.min(days, axisDays), axisDays, label, live: start <= now && (!end || end >= now), payPeriod };
  };
  if (choice === "month") {
    const start = now.slice(0, 8) + "01";
    const end = addDays(new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7), 1)).toISOString().slice(0, 10), -1);
    return fit(start, end, `${monthName.format(new Date(start + "T00:00:00Z"))}`);
  }
  if (choice === "custom") return fit(custom.start, custom.end, `${day(custom.start)} – ${day(custom.end)}`);
  const p = ctx.pay_periods.find((x) => `p${x.id}` === choice) ?? ctx.current_period!;
  return fit(p.period_start, p.period_end, p.period_end ? `${day(p.period_start)} – ${day(p.period_end)}` : `${day(p.period_start)} – today`, p.id);
}

function expenseByCategory(s: Summary) {
  const m = new Map<string, number>();
  for (const r of s.by_category) if (r.type === "expense") m.set(r.category, (m.get(r.category) ?? 0) + Number(r.total));
  return m;
}

// What "usual" means. A pay period is one pot: the salary lands once on day one and spending
// draws it down, unevenly (rent and subscriptions go early). So income is only ever compared
// a whole pay period at a time, and spending by day n is the average running total on day n
// of the closed pay periods. Without a closed period, fall back to get_averages, spread evenly.
type Usual = {
  spentBy: (n: number) => number;
  length: number;
  perIn: number;
  perOut: number;
  catShare: (cat: string) => number;
  unit: "pay period" | "month";
  basis: string;
};

function usualFor(n: Numbers, ctx: Context): Usual | null {
  if (n.baseline) {
    const { period_start, period_end, summary } = n.baseline;
    const closed = ctx.pay_periods.filter((p) => p.status === "closed" && p.period_end && p.period_start >= period_start && p.period_end <= period_end);
    const daily = new Map<string, number>();
    for (const r of summary.by_period) if (r.type === "expense") daily.set(r.period, (daily.get(r.period) ?? 0) + Number(r.total));
    const runs = closed.map((p) => {
      const run = [0];
      for (let i = 0; i < span(p.period_start, p.period_end!); i++) run.push(run[i] + (daily.get(addDays(p.period_start, i)) ?? 0));
      return run;
    });
    const lens = runs.map((r) => r.length - 1).sort((a, b) => a - b);
    const longest = lens[lens.length - 1];
    const avg = Array.from({ length: longest + 1 }, (_, i) => runs.reduce((s, r) => s + r[Math.min(i, r.length - 1)], 0) / runs.length);
    const perOut = avg[longest];
    const cats = expenseByCategory(summary);
    return {
      spentBy: (d) => (d <= longest ? avg[d] : perOut + ((d - longest) * perOut) / longest),
      length: lens[Math.floor(lens.length / 2)],
      perIn: summary.totals.income / runs.length,
      perOut,
      catShare: (cat) => (cats.get(cat) ?? 0) / runs.length,
      unit: "pay period",
      basis: `${plural(runs.length, "closed pay period")}, ${day(period_start)} – ${day(period_end)}`,
    };
  }
  const a = n.averages;
  if (!a.period_count) return null;
  const cats = expenseByCategory(n.history);
  return {
    spentBy: (d) => (a.average_expense / MONTH_DAYS) * d,
    length: Math.round(MONTH_DAYS),
    perIn: a.average_income,
    perOut: a.average_expense,
    catShare: (cat) => (cats.get(cat) ?? 0) / a.period_count,
    unit: "month",
    basis: `${plural(a.period_count, "calendar month")} since ${monthName.format(new Date(a.by_period[0].period + "-01T00:00:00Z"))}`,
  };
}

// usual spending by day d of the range: a finished pay period is one whole pot against the
// usual whole pot; a running one follows the pay period's own shape; anything else gets an
// even daily rate (a calendar month cuts a pay period in two)
const usualBy = (u: Usual, r: Range, d: number) => {
  if (r.payPeriod && r.end && !r.live && d >= r.axisDays) return u.perOut;
  return r.payPeriod ? u.spentBy(d) : (u.perOut / u.length) * d;
};
const signedPct = (ratio: number) => {
  const p = Math.round((ratio - 1) * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`;
};

export function DashboardPage() {
  usePageTitle("Dashboard");
  const [ctx, setCtx] = useState<Context | null>(null);
  const [choice, setChoice] = useState("");
  const [account, setAccount] = useState("");
  const [custom, setCustom] = useState({ start: today().slice(0, 8) + "01", end: today() });
  const [nums, setNums] = useState<Numbers | null>(null);
  const [failed, setFailed] = useState(false);
  const side = useRef<HTMLElement>(null);

  // The record column is sticky. When it is taller than the window, pinning it by its top would
  // leave its foot out of reach until the page ends, so it pins by its foot instead.
  useEffect(() => {
    const el = side.current;
    if (!el) return;
    const fit = () => el.style.setProperty("--side-top", `${Math.min(24, innerHeight - el.offsetHeight - 24)}px`);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    addEventListener("resize", fit);
    return () => { ro.disconnect(); removeEventListener("resize", fit); };
  }, []);

  useEffect(() => {
    api<Context>("/dashboard/context")
      .then((c) => {
        setCtx(c);
        // a link from the assistant can open on a pay period, a date range, or one account;
        // anything here that doesn't match this user's data falls back to the usual view
        const q = new URLSearchParams(location.search);
        const from = q.get("from") ?? "", to = q.get("to") ?? "";
        if (c.pay_periods.some((p) => String(p.id) === q.get("period"))) setChoice(`p${q.get("period")}`);
        else if (isDay(from) && isDay(to) && from <= to) {
          setCustom({ start: from, end: to });
          setChoice("custom");
        } else setChoice(c.current_period ? `p${c.current_period.id}` : "month");
        if (c.accounts.accounts.some((a) => a.name === q.get("account"))) setAccount(q.get("account")!);
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
    if (range.payPeriod) q.set("pay_period_id", String(range.payPeriod));
    let live = true;
    setNums(null);
    api<Numbers>(`/dashboard/summary?${q}`)
      // get_budget_summary answers even for a pay period with no groups; that is no budget at all
      .then((n) => live && setNums({ ...n, budget: n.budget?.groups.some((g) => g.budget_type === "spending") ? n.budget : null }))
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
  const usual = nums && ctx ? usualFor(nums, ctx) : null;

  return (
    <div className="page dash">
      <aside className="dash-side" ref={side}>
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

        {!badCustom && <PeriodRecord nums={nums} range={range} usual={usual} account={account} />}
      </aside>

      {badCustom ? (
        <div className="dash-main">
          <div className="notice"><p>Nothing to show for these dates. Set From on or before To and the numbers come back.</p></div>
        </div>
      ) : (
        <div className="dash-main" aria-busy={!nums || undefined}>
          <Pace nums={nums} range={range} usual={usual} />
          <WhereItWent nums={nums} range={range} usual={usual} account={account} />
          <Accounts nums={nums} ctx={ctx} account={account} />
          <Months nums={nums} choice={choice} onPick={setChoice} />
        </div>
      )}
    </div>
  );
}

// what is left of the pot, assuming each spending group gets at least its budget
const leftOnBudget = (income: number, b: Budget) =>
  income - b.groups.filter((g) => g.budget_type === "spending").reduce((s, g) => s + Math.max(g.budget_amount, g.actual_amount), 0) - b.unbudgeted.total_amount;

function PeriodRecord({ nums, range, usual, account }: { nums: Numbers | null; range: Range | null; usual: Usual | null; account: string }) {
  if (!nums || !range) return <section className="sheet stacked"><Skeletons n={4} /></section>;
  const { totals } = nums.summary;
  const { budget } = nums;
  const u = range.days > 0 ? usual : null;
  // only a pay period still running has a pay day ahead to estimate
  const ahead = range.payPeriod && range.live && !range.end;
  const payDay = u ? addDays(range.start, Math.max(u.length, range.days) - 1) : null;
  const toCome = u ? Math.max(0, u.spentBy(u.length) - u.spentBy(range.days)) : 0;
  const atPayDay = totals.net - toCome;

  let key: { legend: string; figure: string; note: string | null };
  if (ahead && u) key = { legend: `Left at pay day, ${day(payDay!)}`, figure: approx(atPayDay, true), note: `if you spend as usual from here, ${approx(toCome)} more` };
  else if (range.payPeriod) key = { legend: range.live ? "Left so far" : "Left at pay day", figure: money(totals.net, true), note: u && u.unit === "pay period" ? `usual pay period: ${approx(u.perIn - u.perOut, true)}` : null };
  else key = { legend: "Net", figure: money(totals.net, true), note: null };

  return (
    <section className="sheet stacked" aria-labelledby="period-title">
      <h2 className="title record-title" id="period-title">This period</h2>
      <div className="keyfig">
        <span className="legend">{key.legend}</span>
        <span className="figure">{key.figure}</span>
        {key.note && <span className="note">{key.note}</span>}
        {ahead && budget && <span className="note">on budget: <span className="money">{approx(leftOnBudget(totals.income, budget), true)}</span></span>}
      </div>
      <table className="record figures">
        <tbody>
          <tr>
            <th scope="row">Income</th>
            <td className="num"><span className="money">{money(totals.income)}</span>{u && range.payPeriod && u.unit === "pay period" && <span className="note">usual <span className="nowrap">{approx(u.perIn)}</span></span>}</td>
          </tr>
          <tr>
            <th scope="row">Spent</th>
            <td className="num"><span className="money">{money(-totals.expense)}</span>{u && <span className="note">{range.live ? "usual by now" : "usual"} <span className="nowrap">{approx(-usualBy(u, range, range.days))}</span></span>}</td>
          </tr>
          {budget && (
            <tr>
              <th scope="row">Budget</th>
              <td className="num"><span className="money">{money(budget.period_info.total_budget_spending)}</span><span className="note">{budget.period_info.total_remaining >= 0 ? `${money(budget.period_info.total_remaining)} not spent yet` : `${money(-budget.period_info.total_remaining)} over`}</span></td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="small muted record-foot">
        {plural(totals.transaction_count, "transaction")} in this period{account ? ` from ${account}` : ""}.
        {u && ` "Usual" is the average of your ${u.basis}.`}
        {range.payPeriod && !budget && account && " Budgets cover every account, so they show with All accounts."}
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

// a round axis top: 1, 2 or 5 times a power of ten, so the gridlines read as plain numbers
function niceTop(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

function Pace({ nums, range, usual }: { nums: Numbers | null; range: Range | null; usual: Usual | null }) {
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
  const budgetTotal = nums?.budget?.period_info.total_budget_spending ?? 0;
  // the line draws the shape; the reading beside it uses the same figure as the record card
  const ref = (d: number) => (usual && range ? (range.payPeriod ? usual.spentBy(d) : usualBy(usual, range, d)) : 0);
  const usualToday = usual && range ? usualBy(usual, range, range.days) : 0;
  const whole = range?.payPeriod && range.end && !range.live;
  // an open pay period runs to the same estimated pay day the record card names
  const axis = range ? (range.end || !usual ? range.axisDays : Math.max(range.days, usual.length)) : 1;
  const top = niceTop(Math.max(run, ref(axis), budgetTotal, 1));
  const ahead = usualToday > 0 ? run / usualToday - 1 : null;

  const h = 240, padL = 52, padR = 8, padT = 28, padB = 26;
  const W = Math.max(width, 280);
  const x = (d: number) => padL + (d / axis) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / top) * (h - padT - padB);
  const path = steps.reduce((acc, s, i) => acc + `H${x(s.x - 1).toFixed(1)}V${y(s.y).toFixed(1)}` + (i === steps.length - 1 ? `H${x(s.x).toFixed(1)}` : ""), `M${x(0)} ${y(0)}`);
  const usualPath = range && usual ? Array.from({ length: axis + 1 },(_, d) => `${d ? "L" : "M"}${x(d).toFixed(1)} ${y(ref(d)).toFixed(1)}`).join("") : "";
  const tx = range ? x(range.days) : 0;

  let gap = "";
  if (ready && ahead !== null) {
    const pct = Math.round(Math.abs(ahead) * 100);
    gap = pct < 3 ? "about your usual" : `${pct}% ${ahead > 0 ? "more" : "less"} than usual`;
    gap += whole ? " for a pay period" : ` by day ${range.days}`;
  }

  return (
    <section className="sheet" aria-labelledby="pace-title">
      <div className="section-head">
        <h2 className="title" id="pace-title">Spending through the period</h2>
        <p className="small muted">
          {ready ? <>{range.live ? "So far" : "In all"} <span className="nowrap">{money(run)}</span>{gap && <>, {gap}</>}. </> : null}
          Dashed line: what you usually have spent by each day{usual?.unit === "pay period" && range?.payPeriod ? " of a pay period" : ""}{budgetTotal ? "; solid line: your budget" : ""}.
        </p>
      </div>
      <div ref={box} className="chart">
        {!ready || width === 0 ? <div className="skeleton" style={{ height: h }} /> : (
          <svg width={W} height={h} role="img" aria-label={`Spent ${money(run)}; usual by now ${money(usualToday)}${budgetTotal ? `; budget ${money(budgetTotal)}` : ""}.`}>
            {[top / 2, top].map((v) => (
              <g key={v}>
                <line className="grid" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} />
                <text className="tick" x={padL - 6} y={y(v) + 4} textAnchor="end">{compact.format(v)}</text>
              </g>
            ))}
            <text className="tick" x={padL - 6} y={y(0) + 4} textAnchor="end">0</text>
            {budgetTotal > 0 && (
              <g className="budget">
                <line x1={padL} x2={W - padR} y1={y(budgetTotal)} y2={y(budgetTotal)} />
                <text x={padL + 6} y={y(budgetTotal) - 6}>Budget {compact.format(budgetTotal)}</text>
              </g>
            )}
            <line className="axis" x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} />
            {usualPath && <path className="avg" d={usualPath} />}
            <path className="run" d={path} />
            {range.live && (
              <g className="today">
                <line x1={tx} x2={tx} y1={padT - 10} y2={y(0)} />
                <text x={tx > W - 200 ? tx - 6 : tx + 6} y={padT - 2} textAnchor={tx > W - 200 ? "end" : "start"}>Today {money(run)}</text>
              </g>
            )}
            <text className="tick" x={padL} y={h - 6}>{day(range.start)}</text>
            <text className="tick" x={W - padR} y={h - 6} textAnchor="end">{day(addDays(range.start, axis - 1))}{range.end ? "" : " (est.)"}</text>
          </svg>
        )}
      </div>
    </section>
  );
}

type Line = { key: string; label: string; amt: number; ref: number | null; cats: string[]; note?: string };

function WhereItWent({ nums, range, usual, account }: { nums: Numbers | null; range: Range | null; usual: Usual | null; account: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [txns, setTxns] = useState<Txn[] | null>(null);

  useEffect(() => { setOpen(null); setPicked(null); }, [nums]);
  useEffect(() => {
    if (!picked || !range) return;
    const q = new URLSearchParams({ start_date: range.start, category: picked });
    if (range.end) q.set("end_date", range.end);
    if (account) q.set("account", account);
    let live = true;
    setTxns(null);
    api<Txn[]>(`/dashboard/transactions?${q}`).then((t) => live && setTxns(t)).catch(() => live && setTxns([]));
    return () => { live = false; };
  }, [picked, range, account]);

  if (!nums || !range) return <section className="sheet"><h2 className="title">Where it went</h2><Skeletons n={5} /></section>;
  const spent = expenseByCategory(nums.summary);
  const { expense } = nums.summary.totals;
  const { budget } = nums;
  const u = range.days > 0 ? usual : null;
  // a category's usual by day d follows the whole pay period's shape, scaled to its share
  const share = u ? usualBy(u, range, range.days) / u.perOut : 0;

  let lines: Line[];
  let totalRef: number | null;
  if (budget) {
    lines = budget.groups
      .filter((g) => g.budget_type === "spending")
      .map((g) => ({ key: `g${g.group_id}`, label: g.name, amt: g.actual_amount, ref: g.budget_amount, cats: g.categories }));
    if (budget.unbudgeted.total_amount > 0) {
      const cats = budget.unbudgeted.categories.map((c) => c.category);
      lines.push({ key: "none", label: "Not in a budget", amt: budget.unbudgeted.total_amount, ref: null, cats, note: cats.join(", ") });
    }
    totalRef = budget.period_info.total_budget_spending;
  } else {
    lines = [...spent].map(([cat, amt]) => ({ key: cat, label: cat, amt, ref: u && u.catShare(cat) > 0 ? u.catShare(cat) * share : null, cats: [cat] }));
    totalRef = u ? usualBy(u, range, range.days) : null;
  }
  // biggest first; the leftovers that belong to no group go last whatever their size
  lines.sort((a, b) => Number(a.key === "none") - Number(b.key === "none") || b.amt - a.amt);

  // Each row is measured against its own budget (or usual), so the reference is one straight
  // line at 100% down the whole list and "over" reads as crossing it. The scale stops at 200%;
  // anything further is cut with a » and its real % stays in the last column.
  const over = (l: Line) => (l.ref ? l.amt / l.ref - 1 : 0);
  const totalRatio = totalRef ? expense / totalRef : 0;
  const top = Math.min(2, Math.max(1.25, totalRatio, ...lines.map((l) => over(l) + 1)));
  const pos = (ratio: number) => (Math.min(ratio, top) / top) * 100;
  const worst = lines.reduce<Line | null>((w, l) => (over(l) > 0.1 && (!w || over(l) > over(w)) ? l : w), null);
  const vs = budget ? "budget" : "usual";
  const bar = (amt: number, ref: number | null) =>
    ref ? (
      <>
        <i className="out" style={{ left: 0, width: `${Math.max(pos(amt / ref), 0.4)}%` }} />
        {amt / ref > top && <b className="clip" aria-hidden="true">»</b>}
        <u style={{ left: `${pos(1)}%` }} aria-hidden="true" />
      </>
    ) : (
      <>
        <span className="nobar">{budget ? "no budget" : "nothing usual yet"}</span>
        <u style={{ left: `${pos(1)}%` }} aria-hidden="true" />
      </>
    );

  return (
    <section className="sheet" aria-labelledby="where-title">
      <div className="section-head">
        <h2 className="title" id="where-title">Where it went</h2>
        <p className="small muted">
          {budget
            ? "How much of each group's budget is spent. The line is the budget; past it is over."
            : u
              ? `Each category against what you usually spend on it ${range.payPeriod && range.end && !range.live ? "in a pay period" : `by day ${range.days}`}. The line is your usual; past it is more.`
              : "Spending by category."}{" "}
          Open a row for the detail.
        </p>
      </div>
      {expense === 0 ? <p className="empty">No spending recorded in this period{range.end ? "" : " yet"}.</p> : (
        <ol className="steps-down bars">
          <li className="step head" aria-hidden="true">
            <span className="legend">{budget ? "Group" : "Category"}</span>
            <span className="track">{(budget || u) && <span className="mark" style={{ left: `${pos(1)}%` }}>{budget ? "Budget" : "Usual"}</span>}</span>
            <span className="legend amt">Spent</span>
            <span className="legend dev">vs {vs}</span>
          </li>
          {lines.map((l) => {
            const isOpen = open === l.key;
            return (
              <Fragment key={l.key}>
                <li className={`step${worst?.key === l.key ? " key" : ""}${isOpen ? " open" : ""}`}>
                  <span className="legend">
                    <button type="button" className="row-toggle" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : l.key); setPicked(null); }}>{l.label}</button>
                  </span>
                  <span className="track">{(budget || u) ? bar(l.amt, l.ref) : <i className="out" style={{ left: 0, width: `${(l.amt / lines[0].amt) * 100}%` }} />}</span>
                  <span className="amt">{money(-l.amt)}{l.ref !== null && <span className="of">of {budget ? money(l.ref) : approx(l.ref)}</span>}</span>
                  <span className="dev">{l.ref ? signedPct(l.amt / l.ref) : u || budget ? "—" : ""}</span>
                </li>
                {isOpen && (
                  <li className="detail">
                    <ul className="cats">
                      {l.cats.filter((c) => spent.get(c)).sort((a, b) => spent.get(b)! - spent.get(a)!).map((c) => (
                        <li key={c}>
                          <button type="button" className="row-toggle" aria-expanded={picked === c} onClick={() => setPicked(picked === c ? null : c)}>{c}</button>
                          <span className="amt">{money(-spent.get(c)!)}</span>
                          {picked === c && (
                            <ul className="txns" aria-busy={!txns || undefined}>
                              {!txns ? <li className="skeleton" /> : txns.map((t) => (
                                <li key={t.id}>
                                  <span className="when">{day(new Date(t.occurred_at).toISOString())}</span>
                                  <span className="what">{t.description ?? "—"}</span>
                                  <span className="amt">{money(-Number(t.amount))}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                      {!l.cats.some((c) => spent.get(c)) && <li className="muted">Nothing spent here yet.</li>}
                    </ul>
                  </li>
                )}
              </Fragment>
            );
          })}
          <li className="step total">
            <span className="legend">Spent</span>
            <span className="track">{totalRef ? bar(expense, totalRef) : null}</span>
            <span className="amt">{money(-expense)}{totalRef !== null && <span className="of">of {budget ? money(totalRef) : approx(totalRef)}</span>}</span>
            <span className="dev">{totalRef ? signedPct(expense / totalRef) : ""}</span>
          </li>
        </ol>
      )}
      {worst && <p className="small record-foot">{worst.label} is furthest over its {vs}: {Math.round(over(worst) * 100)}% more.</p>}
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

function Months({ nums, choice, onPick }: { nums: Numbers | null; choice: string; onPick: (c: string) => void }) {
  if (!nums) return <section className="sheet"><h2 className="title">Over time</h2><Skeletons n={4} /></section>;
  // pay periods when there are any, so a salary sits beside what it paid for; calendar months otherwise
  const byPay = nums.trend.length > 0;
  const rows = byPay
    ? nums.trend.map((p) => ({
        key: `p${p.id}`,
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
        <p className="small muted">{byPay ? "Your pay periods, newest first. Pick one to see it above." : "Calendar months, newest first."}</p>
      </div>
      <div className="table-wrap">
        <table className="record cards-sm labelled months">
          <thead><tr><th scope="col" className="legend">{unit}</th><th scope="col" className="legend">In and out</th><th scope="col" className="legend num">Net</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={choice === r.key ? "picked" : undefined}>
                <td data-label={unit}>
                  {byPay ? <button type="button" className="row-toggle" aria-current={choice === r.key || undefined} onClick={() => onPick(r.key)}>{r.label}</button> : r.label}
                </td>
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
