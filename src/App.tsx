import { useMemo, useState, type ReactNode } from "react";
import "./styles.css";
import { OPERATORS, ROOMS, SHIFTS, roomByCode } from "./catalog";
import { GRADES, PRESSURE_RULE, RULES_VERSION, evaluateClose } from "./rules";
import {
  addNote,
  clearStoredLog,
  closeTicket,
  derive,
  exportLog,
  formatDateTime,
  loadLog,
  makeDemoLog,
  saveLog,
  submitSample,
  ticketSamples,
  verifyChain,
  type Entry,
  type Sample,
  type State,
  type Ticket,
} from "./archive";

type Notice = { kind: "ok" | "err"; text: string };

function num(v: number): string {
  return v.toLocaleString("zh-CN");
}

function Badge({ pass, children }: { pass: boolean; children: ReactNode }) {
  return <span className={`badge ${pass ? "badge-ok" : "badge-bad"}`}>{children}</span>;
}

function ParticleCell({ value, limit }: { value: number; limit: number }) {
  const over = value > limit;
  return (
    <span className={over ? "val-over" : "val-ok"}>
      {num(value)}
      <small> / ≤{num(limit)}</small>
    </span>
  );
}

function DpCell({ value }: { value: number }) {
  const stable = value >= PRESSURE_RULE.min && value <= PRESSURE_RULE.max;
  return (
    <span className={stable ? "val-ok" : "val-over"}>
      {value}
      <small> / {PRESSURE_RULE.min}–{PRESSURE_RULE.max}Pa</small>
    </span>
  );
}

function SampleRows({ state, ticket }: { state: State; ticket: Ticket }) {
  const rule = GRADES.find((g) => g.id === ticket.grade)!;
  const samples = ticketSamples(state, ticket);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>性质</th>
            <th>时间 / 班次</th>
            <th>≥0.5μm（粒/m³）</th>
            <th>≥5.0μm（粒/m³）</th>
            <th>压差</th>
            <th>判定</th>
            <th>采样人 / 说明</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s, i) => (
            <tr key={s.id} className={i === 0 ? "origin-row" : ""}>
              <td>
                <span className={`kind-tag ${s.kind === "复测" ? "tag-retest" : "tag-origin"}`}>{s.kind}</span>
                <br />
                <small>{s.id}</small>
              </td>
              <td>
                {formatDateTime(s.ts)}
                <br />
                <small>{s.shift}</small>
              </td>
              <td>
                <ParticleCell value={s.p05} limit={rule.limits.p05} />
              </td>
              <td>
                <ParticleCell value={s.p5} limit={rule.limits.p5} />
              </td>
              <td>
                <DpCell value={s.dp} />
              </td>
              <td>
                <Badge pass={s.verdict.particlePass}>粒子</Badge> <Badge pass={s.verdict.pressurePass}>压差</Badge>
                {i === 0 && !s.verdict.pass && <div className="locked-hint">🔒 原始异常值，封存不可改</div>}
              </td>
              <td>
                {s.operator}
                {s.note && <small className="cell-note">{s.note}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketCard({
  log,
  state,
  ticket,
  onCommit,
}: {
  log: Entry[];
  state: State;
  ticket: Ticket;
  onCommit: (entry: Entry) => void;
}) {
  const room = roomByCode(ticket.roomCode);
  const rule = GRADES.find((g) => g.id === ticket.grade)!;
  const samples = ticketSamples(state, ticket);
  const latest = samples.filter((s) => s.kind === "复测").at(-1) ?? null;

  const [noteActor, setNoteActor] = useState(OPERATORS[2]);
  const [noteText, setNoteText] = useState("");
  const [disposer, setDisposer] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const closePreview = evaluateClose({
    hasRetest: !!latest,
    latest: latest
      ? { particlePass: latest.verdict.particlePass, pressurePass: latest.verdict.pressurePass }
      : null,
    disposer,
    reviewer,
  });
  const recoveryReady = closePreview.checks.slice(0, 3).every((c) => c.pass);

  return (
    <article className={`ticket-card ${ticket.status === "已关闭" ? "ticket-closed" : ""}`}>
      <header className="ticket-head">
        <div>
          <h3>{ticket.id}</h3>
          <p>
            {room.code} {room.name} · {rule.name} · 建单 {formatDateTime(ticket.openedAt)}
          </p>
        </div>
        <span className={`status-pill ${ticket.status === "未结" ? "pill-open" : "pill-closed"}`}>
          {ticket.status}
        </span>
      </header>

      <SampleRows state={state} ticket={ticket} />

      {ticket.notes.length > 0 && (
        <ul className="note-list">
          {ticket.notes.map((n, i) => (
            <li key={i}>
              <strong>{n.actor}</strong> <time>{formatDateTime(n.at)}</time>
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      )}

      {ticket.status === "未结" ? (
        <div className="ticket-actions">
          <div className="action-block">
            <h4>处置记录（追加留档）</h4>
            <div className="note-form">
              <select value={noteActor} onChange={(e) => setNoteActor(e.target.value)}>
                {OPERATORS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <input
                placeholder="处置措施 / 观察，如：更换过滤器、延长自净…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <button
                onClick={() => {
                  setErr(null);
                  try {
                    const entry = addNote(log, {
                      ticketId: ticket.id,
                      actor: noteActor,
                      text: noteText,
                    });
                    onCommit(entry);
                    setNoteText("");
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                追加记录
              </button>
            </div>
          </div>

          <div className="action-block">
            <h4>关闭条件核验</h4>
            <ul className="check-list">
              {closePreview.checks.map((c) => (
                <li key={c.id} className={c.pass ? "check-pass" : "check-fail"}>
                  <span>{c.pass ? "✓" : "✗"}</span>
                  <div>
                    <strong>{c.label}</strong>
                    <small>{c.detail}</small>
                  </div>
                </li>
              ))}
            </ul>
            <div className="close-form">
              <select value={disposer} onChange={(e) => setDisposer(e.target.value)}>
                <option value="">选择处置人</option>
                {OPERATORS.map((o) => (
                  <option key={o} value={o}>
                    处置：{o}
                  </option>
                ))}
              </select>
              <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
                <option value="">选择复核人</option>
                {OPERATORS.map((o) => (
                  <option key={o} value={o}>
                    复核：{o}
                  </option>
                ))}
              </select>
              <button
                className="primary-action"
                disabled={!recoveryReady}
                title={recoveryReady ? "" : "粒子与压差须在最新复测中同时恢复"}
                onClick={() => {
                  setErr(null);
                  try {
                    const entry = closeTicket(log, {
                      ticketId: ticket.id,
                      disposer,
                      reviewer,
                    });
                    onCommit(entry);
                    setDisposer("");
                    setReviewer("");
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                双签关闭异常
              </button>
            </div>
            {!recoveryReady && (
              <p className="form-hint">两项未同时恢复前，关闭按钮锁定；关闭后原值与复测全部封存。</p>
            )}
          </div>
        </div>
      ) : (
        ticket.close && (
          <div className="close-record">
            <h4>关闭签认（已封存）</h4>
            <p>
              {formatDateTime(ticket.close.at)} 关闭 · 处置人 <strong>{ticket.close.disposer}</strong> · 复核人{" "}
              <strong>{ticket.close.reviewer}</strong>
            </p>
            <ul className="check-list check-list-inline">
              {ticket.close.checks.map((c) => (
                <li key={c.id} className="check-pass">
                  <span>✓</span>
                  <small>{c.detail}</small>
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {err && <p className="error-banner">{err}</p>}
    </article>
  );
}

function SamplingForm({ onCommit, log }: { onCommit: (entry: Entry) => void; log: Entry[] }) {
  const [roomCode, setRoomCode] = useState(ROOMS[0].code);
  const room = roomByCode(roomCode);
  const [grade, setGrade] = useState(room.grade);
  const [p05, setP05] = useState("");
  const [p5, setP5] = useState("");
  const [dp, setDp] = useState("");
  const [shift, setShift] = useState<(typeof SHIFTS)[number]>(SHIFTS[0]);
  const [operator, setOperator] = useState(OPERATORS[0]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const state = useMemo(() => derive(log), [log]);
  const openTicket = state.ticketOrder
    .map((id) => state.tickets[id])
    .find((t) => t.roomCode === roomCode && t.status === "未结");

  const changeRoom = (code: string) => {
    setRoomCode(code);
    setGrade(roomByCode(code).grade);
    setNotice(null);
  };

  const submit = () => {
    setNotice(null);
    try {
      const entry = submitSample(log, {
        roomCode,
        grade,
        p05: Number(p05),
        p5: Number(p5),
        dp: Number(dp),
        shift,
        operator,
        note,
      });
      onCommit(entry);
      const p = entry.payload as Extract<Entry["payload"], { ticketId?: string | null }> & {
        ticketId: string | null;
        kind: string;
      };
      if (p.ticketId && p.kind === "复测") {
        setNotice({
          kind: "ok",
          text: `该房间有未结异常单，本次采样已作为复测续到 ${p.ticketId}（不另开新单）。`,
        });
      } else if (p.ticketId) {
        setNotice({
          kind: "err",
          text: `判定超限，已自动建单 ${p.ticketId}；原始读数封存，复测只能追加，改回合理读数不会覆盖原值。`,
        });
      } else {
        setNotice({ kind: "ok", text: "采样合格，已留档（房间/等级/粒子数/压差/班次/采样人）。" });
      }
      setP05("");
      setP5("");
      setDp("");
      setNote("");
    } catch (e) {
      setNotice({ kind: "err", text: (e as Error).message });
    }
  };

  const rule = GRADES.find((g) => g.id === grade)!;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>采样留档</p>
          <h2>采样录入</h2>
        </div>
      </div>
      {openTicket && (
        <div className="reroute-banner">
          房间 {roomCode} 存在未结异常单 <strong>{openTicket.id}</strong>
          ，本次提交将作为复测追加到该单，不新建单据。
        </div>
      )}
      <div className="form-grid">
        <label>
          <span>房间</span>
          <select value={roomCode} onChange={(e) => changeRoom(e.target.value)}>
            {ROOMS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code} · {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>洁净等级（默认取自房间台账）</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value as typeof grade)}>
            {GRADES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>≥0.5μm 粒子数（粒/m³，上限 {num(rule.limits.p05)}）</span>
          <input inputMode="numeric" value={p05} onChange={(e) => setP05(e.target.value)} placeholder="如 2600" />
        </label>
        <label>
          <span>≥5.0μm 粒子数（粒/m³，上限 {num(rule.limits.p5)}）</span>
          <input inputMode="numeric" value={p5} onChange={(e) => setP5(e.target.value)} placeholder="如 12" />
        </label>
        <label>
          <span>静压差（Pa，稳定区间 {PRESSURE_RULE.min}–{PRESSURE_RULE.max}）</span>
          <input inputMode="numeric" value={dp} onChange={(e) => setDp(e.target.value)} placeholder="如 18" />
        </label>
        <label>
          <span>班次</span>
          <select value={shift} onChange={(e) => setShift(e.target.value as typeof shift)}>
            {SHIFTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span>采样人</span>
          <select value={operator} onChange={(e) => setOperator(e.target.value)}>
            {OPERATORS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="span-2">
          <span>现场说明（可选，随采样一起封存）</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：巡检读数 / 更换过滤器后复测" />
        </label>
      </div>
      <div className="form-footer">
        <button className="primary-action" onClick={submit}>
          提交采样（不可修改、不可删除）
        </button>
        {notice && <p className={notice.kind === "ok" ? "ok-banner" : "error-banner"}>{notice.text}</p>}
      </div>
    </section>
  );
}

function LedgerTable({ state }: { state: State }) {
  const [roomFilter, setRoomFilter] = useState("全部");
  const samples = state.samples
    .filter((s) => roomFilter === "全部" || s.roomCode === roomFilter)
    .slice()
    .reverse();

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>只追加台账</p>
          <h2>采样记录（原值封存）</h2>
        </div>
        <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} style={{ maxWidth: 240 }}>
          <option>全部</option>
          {ROOMS.map((r) => (
            <option key={r.code}>{r.code}</option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>性质 / 单号</th>
              <th>房间 / 等级</th>
              <th>时间 / 班次</th>
              <th>≥0.5μm</th>
              <th>≥5.0μm</th>
              <th>压差</th>
              <th>判定</th>
              <th>采样人</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((s: Sample) => {
              const rule = GRADES.find((g) => g.id === s.grade)!;
              return (
                <tr key={s.id}>
                  <td>
                    <span className={`kind-tag ${s.kind === "复测" ? "tag-retest" : "tag-origin"}`}>{s.kind}</span>
                    {s.ticketId ? (
                      <small className="ticket-link">↳ {s.ticketId}</small>
                    ) : (
                      <small className="cell-note">常态留档</small>
                    )}
                  </td>
                  <td>
                    {s.roomCode}
                    <br />
                    <small>{rule.name}</small>
                  </td>
                  <td>
                    {formatDateTime(s.ts)}
                    <br />
                    <small>{s.shift} · {s.id}</small>
                  </td>
                  <td>
                    <ParticleCell value={s.p05} limit={rule.limits.p05} />
                  </td>
                  <td>
                    <ParticleCell value={s.p5} limit={rule.limits.p5} />
                  </td>
                  <td>
                    <DpCell value={s.dp} />
                  </td>
                  <td>
                    <Badge pass={s.verdict.particlePass}>粒子</Badge> <Badge pass={s.verdict.pressurePass}>压差</Badge>
                  </td>
                  <td>{s.operator}</td>
            </tr>
              );
            })}
            {samples.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-cell">
                  暂无采样记录，可从下方“存档维护”载入演示数据。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function App() {
  const [log, setLog] = useState<Entry[]>(() => loadLog());
  const state = useMemo(() => derive(log), [log]);
  const integrity = useMemo(() => verifyChain(log), [log]);

  const commit = (entry: Entry) => {
    const next = [...log, entry];
    saveLog(next);
    setLog(next);
  };

  const openTickets = state.ticketOrder.map((id) => state.tickets[id]).filter((t) => t.status === "未结");
  const closedTickets = state.ticketOrder.map((id) => state.tickets[id]).filter((t) => t.status === "已关闭");
  const closable = openTickets.filter((t) => {
    const retests = ticketSamples(state, t).filter((s) => s.kind === "复测");
    const latest = retests.at(-1);
    return !!latest && latest.verdict.particlePass && latest.verdict.pressurePass;
  });

  const loadDemo = () => {
    if (log.length > 0 && !window.confirm("载入演示数据将覆盖当前本机存档，确定继续？")) return;
    const demo = makeDemoLog();
    saveLog(demo);
    setLog(demo);
  };

  const wipe = () => {
    if (!window.confirm("清空本机存档？历史采样与异常单将全部删除。")) return;
    clearStoredLog();
    setLog([]);
  };

  const download = () => {
    const blob = new Blob([exportLog(log)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleanroom-archive-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-09 · 洁净室超限处置台</p>
          <h1>半导体洁净室采样与异常处置</h1>
          <p className="subtitle">
            采样按房间、等级、粒子数、压差、班次留档；同房间未结异常一律续单复测。
            粒子按等级上限判定，压差 15–25Pa 为稳定；两项复测同时恢复且处置人与复核人不同，异常方可关闭。
            关闭后原始值、复测记录与签认人全部封存。
          </p>
        </div>
        <div className="stack-card">
          <span>判定标准版本</span>
          <strong>{RULES_VERSION}</strong>
          <span className={integrity.ok ? "chain-ok" : "chain-bad"}>
            {integrity.ok
              ? `🔗 哈希链完整（${log.length} 条事件）`
              : `⚠ 第 ${integrity.brokenAt} 条事件起被改动`}
          </span>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <span>未结异常单</span>
          <strong>{openTickets.length}</strong>
        </article>
        <article className="metric-card">
          <span>复测已恢复待双签</span>
          <strong>{closable.length}</strong>
        </article>
        <article className="metric-card">
          <span>已关闭并封存</span>
          <strong>{closedTickets.length}</strong>
        </article>
        <article className="metric-card">
          <span>采样留档总数</span>
          <strong>{state.samples.length}</strong>
        </article>
      </section>

      <section className="workspace">
        <SamplingForm onCommit={commit} log={log} />
      </section>

      <section className="rules-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>判定层</p>
              <h2>粒子上限（按等级）</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>等级</th>
                  <th>≥0.5μm 粒/m³</th>
                  <th>≥5.0μm 粒/m³</th>
                </tr>
              </thead>
              <tbody>
                {GRADES.map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td>{num(g.limits.p05)}</td>
                    <td>{num(g.limits.p5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="form-hint">压差判定：{PRESSURE_RULE.description}，超出区间即判压差不合格。</p>
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>资料层</p>
              <h2>房间台账与名册</h2>
            </div>
          </div>
          <ul className="room-list">
            {ROOMS.map((r) => (
              <li key={r.code}>
                <strong>{r.code}</strong>
                <span>{r.name}</span>
                <em>{GRADES.find((g) => g.id === r.grade)?.name}</em>
              </li>
            ))}
          </ul>
          <p className="form-hint">
            班次：{SHIFTS.join(" / ")}；采样与签认人员：{OPERATORS.join("、")}
          </p>
        </section>
      </section>

      <section className="tickets">
        <div className="section-heading standalone">
          <div>
            <p>异常处置台</p>
            <h2>未结异常单（{openTickets.length}）</h2>
          </div>
        </div>
        {openTickets.map((t) => (
          <TicketCard key={t.id} log={log} state={state} ticket={t} onCommit={commit} />
        ))}
        {openTickets.length === 0 && <p className="empty-banner">当前没有未结异常单。</p>}

        <div className="section-heading standalone closed-heading">
          <div>
            <p>封存档案</p>
            <h2>已关闭异常单（{closedTickets.length}，原值 / 复测 / 签认保留）</h2>
          </div>
        </div>
        {closedTickets.map((t) => (
          <TicketCard key={t.id} log={log} state={state} ticket={t} onCommit={commit} />
        ))}
      </section>

      <LedgerTable state={state} />

      <section className="panel archive-bar">
        <div className="section-heading">
          <div>
            <p>本机存档层（localStorage · 只追加事件 + 哈希链）</p>
            <h2>存档维护</h2>
          </div>
          <div className="bar-actions">
            <button onClick={loadDemo}>载入演示数据</button>
            <button onClick={download} disabled={log.length === 0}>
              导出 JSON
            </button>
            <button className="danger-btn" onClick={wipe} disabled={log.length === 0}>
              清空本机存档
            </button>
          </div>
        </div>
        <p className="form-hint">
          资料（房间/人员）、判定（等级上限/压差区间/关闭条件）、本机存档（事件链）、界面四者分文件维护；
          系统不提供修改或删除已提交采样的入口，任何对历史事件的改动都会在哈希链校验中暴露。
        </p>
      </section>
    </main>
  );
}
