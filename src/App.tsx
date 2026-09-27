// 界面层：处置台交互与渲染。资料见 data.ts，判定见 rules.ts，存档见 storage.ts。
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./styles.css";
import { GRADE_PARTICLE_LIMITS, PRESSURE_RANGE, ROOMS, SHIFTS } from "./data";
import type { ConsoleState, SampleRecord, Shift, Ticket } from "./data";
import {
  checkClosure,
  evaluateSample,
  findOpenTicket,
  particleLimitFor,
  ticketSamples,
} from "./rules";
import { clearState, emptyState, loadState, saveState, seedState } from "./storage";

const fmtNum = (n: number) => n.toLocaleString("zh-CN");
const fmtTime = (iso: string) => new Date(iso).toLocaleString("zh-CN", { hour12: false });

const KIND_LABEL: Record<SampleRecord["kind"], string> = {
  routine: "常规留档",
  initial: "异常原值",
  retest: "复测续单",
};

function roomLabel(roomId: string): string {
  const room = ROOMS.find((r) => r.id === roomId);
  return room ? `${room.id} ${room.name}` : roomId;
}

interface Banner {
  tone: "ok" | "warn" | "danger";
  text: string;
}

interface SampleFields {
  roomId: string;
  particles: number;
  pressure: number;
  shift: Shift;
  sampler: string;
}

// 单条采样读数：超限项标红，已录入的值只展示、不可改
function SampleLine({ sample }: { sample: SampleRecord }) {
  const verdict = evaluateSample(sample.grade, sample.particles, sample.pressure);
  return (
    <div className="sample-line">
      <span className="sample-id">{sample.id}</span>
      <span className={verdict.particleOver ? "value-over" : "value-ok"}>
        粒子 {fmtNum(sample.particles)} 个/m³{verdict.particleOver ? "（超限）" : ""}
      </span>
      <span className={verdict.pressureOver ? "value-over" : "value-ok"}>
        压差 {sample.pressure} Pa{verdict.pressureOver ? "（超限）" : ""}
      </span>
      <span className="sample-meta">
        {sample.shift} · {sample.sampler}
      </span>
      <time>{fmtTime(sample.sampledAt)}</time>
    </div>
  );
}

function SampleForm({
  tickets,
  onSubmit,
}: {
  tickets: Ticket[];
  onSubmit: (fields: SampleFields) => void;
}) {
  const [roomId, setRoomId] = useState(ROOMS[0].id);
  const [particles, setParticles] = useState("");
  const [pressure, setPressure] = useState("");
  const [shift, setShift] = useState<Shift>(SHIFTS[0]);
  const [sampler, setSampler] = useState("");
  const [error, setError] = useState<string | null>(null);

  const room = ROOMS.find((r) => r.id === roomId) ?? ROOMS[0];
  const openTicket = findOpenTicket(tickets, roomId);
  const limit = particleLimitFor(room.grade);

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = Number(particles);
    const d = Number(pressure);
    if (!sampler.trim()) {
      setError("请填写采样人");
      return;
    }
    if (!Number.isInteger(p) || p < 0) {
      setError("粒子数需为不小于 0 的整数");
      return;
    }
    if (!Number.isFinite(d) || d < 0) {
      setError("压差需为不小于 0 的数值");
      return;
    }
    setError(null);
    onSubmit({ roomId, particles: p, pressure: Math.round(d * 10) / 10, shift, sampler: sampler.trim() });
    setParticles("");
    setPressure("");
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="section-heading">
        <div>
          <p>采样留档</p>
          <h2>录入采样</h2>
        </div>
      </div>
      <div className="form-grid">
        <label>
          <span>房间</span>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {ROOMS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} {r.name}（{r.grade}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>班次</span>
          <select value={shift} onChange={(e) => setShift(e.target.value as Shift)}>
            {SHIFTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>粒子数（≥0.5µm，个/m³，{room.grade} 上限 {fmtNum(limit)}）</span>
          <input
            value={particles}
            onChange={(e) => setParticles(e.target.value)}
            inputMode="numeric"
            placeholder={`如 ${fmtNum(limit)}`}
            required
          />
        </label>
        <label>
          <span>压差（Pa，稳定区间 {PRESSURE_RANGE.min}–{PRESSURE_RANGE.max}）</span>
          <input
            value={pressure}
            onChange={(e) => setPressure(e.target.value)}
            inputMode="decimal"
            placeholder="如 18.5"
            required
          />
        </label>
        <label>
          <span>采样人</span>
          <input value={sampler} onChange={(e) => setSampler(e.target.value)} placeholder="姓名" />
        </label>
      </div>

      {openTicket && (
        <p className="hint hint-warn">
          {room.id} 存在未结异常单 {openTicket.id}，本次采样将作为复测续到该单，原值保留不可改。
        </p>
      )}
      {!openTicket && (
        <p className="hint">读数超限将自动开立异常单并锁定原值；未超限则按班次常规留档。</p>
      )}
      {error && <p className="hint hint-danger">{error}</p>}

      <button className="primary-action" type="submit">
        提交采样
      </button>
    </form>
  );
}

function TicketCard({
  ticket,
  samples,
  onClose,
}: {
  ticket: Ticket;
  samples: SampleRecord[];
  onClose: (ticketId: string, handler: string, reviewer: string) => void;
}) {
  const [handler, setHandler] = useState(ticket.handler ?? "");
  const [reviewer, setReviewer] = useState(ticket.reviewer ?? "");

  const initial = samples.find((s) => s.id === ticket.initialSampleId);
  const chain = ticketSamples(ticket, samples);
  const retests = chain.filter((s) => s.id !== ticket.initialSampleId);
  const check = checkClosure(ticket, samples, handler, reviewer);
  const closed = ticket.status === "closed";

  return (
    <article className={`ticket-card ${closed ? "ticket-closed" : ""}`}>
      <header className="ticket-head">
        <div>
          <strong>{ticket.id}</strong>
          <span className="ticket-room">
            {roomLabel(ticket.roomId)} · {ticket.grade}
          </span>
        </div>
        <span className={closed ? "badge badge-closed" : "badge badge-open"}>
          {closed ? "已关闭" : "处置中"}
        </span>
      </header>

      <p className="ticket-time">开单时间：{fmtTime(ticket.openedAt)}</p>

      <div className="kv-block">
        <h4>原值（已锁定）</h4>
        {initial ? <SampleLine sample={initial} /> : <p className="hint">原值记录缺失</p>}
      </div>

      <div className="kv-block">
        <h4>复测记录（{retests.length}）</h4>
        {retests.length === 0 && <p className="hint">尚无复测，采样后将自动续到本单。</p>}
        {retests.map((s) => (
          <SampleLine key={s.id} sample={s} />
        ))}
      </div>

      {closed ? (
        <div className="closure-panel">
          <h4>关闭签认</h4>
          <p className="sign-line">
            处置人 <strong>{ticket.handler}</strong> · 复核人 <strong>{ticket.reviewer}</strong>
          </p>
          <p className="ticket-time">关闭时间：{ticket.closedAt ? fmtTime(ticket.closedAt) : "-"}</p>
          <p className="hint">原值、复测与签认人已留档，只读保存。</p>
        </div>
      ) : (
        <div className="closure-panel">
          <h4>关闭签认</h4>
          <div className="sign-grid">
            <label>
              <span>处置人</span>
              <input value={handler} onChange={(e) => setHandler(e.target.value)} placeholder="姓名" />
            </label>
            <label>
              <span>复核人</span>
              <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="姓名" />
            </label>
          </div>
          <ul className="check-list">
            <li className={check.particleRecovered ? "ok" : "fail"}>
              粒子恢复（最近复测 ≤ {fmtNum(particleLimitFor(ticket.grade))}）
            </li>
            <li className={check.pressureRecovered ? "ok" : "fail"}>
              压差恢复（{PRESSURE_RANGE.min}–{PRESSURE_RANGE.max} Pa）
            </li>
            <li className={check.signersDistinct ? "ok" : "fail"}>处置人与复核人不同且均已签认</li>
          </ul>
          {!check.canClose && check.reasons.length > 0 && (
            <p className="hint hint-danger">{check.reasons.join("；")}</p>
          )}
          <button
            className="primary-action"
            disabled={!check.canClose}
            onClick={() => onClose(ticket.id, handler.trim(), reviewer.trim())}
          >
            关闭异常
          </button>
        </div>
      )}
    </article>
  );
}

function App() {
  const [state, setState] = useState<ConsoleState>(() => loadState() ?? seedState());
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const openTickets = useMemo(
    () => state.tickets.filter((t) => t.status === "open"),
    [state.tickets]
  );
  const closedTickets = useMemo(
    () =>
      state.tickets
        .filter((t) => t.status === "closed")
        .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")),
    [state.tickets]
  );
  const sortedSamples = useMemo(
    () => [...state.samples].sort((a, b) => b.sampledAt.localeCompare(a.sampledAt)),
    [state.samples]
  );
  const retestCount = useMemo(
    () => state.samples.filter((s) => s.kind === "retest").length,
    [state.samples]
  );

  function handleSample(fields: SampleFields) {
    const room = ROOMS.find((r) => r.id === fields.roomId);
    if (!room) return;
    const verdict = evaluateSample(room.grade, fields.particles, fields.pressure);
    const open = findOpenTicket(state.tickets, fields.roomId);
    const nowIso = new Date().toISOString();
    const sampleId = `S-${String(state.seq.sample).padStart(4, "0")}`;

    let tickets = state.tickets;
    let kind: SampleRecord["kind"] = "routine";
    let ticketId: string | null = null;
    let ticketSeq = state.seq.ticket;
    let nextBanner: Banner;

    if (open) {
      // 同房间有未结异常：只续到那张单上，不另开新单
      kind = "retest";
      ticketId = open.id;
      nextBanner = verdict.overLimit
        ? { tone: "warn", text: `${sampleId} 仍超限，已作为复测续到未结异常单 ${open.id}，原值保留。` }
        : { tone: "ok", text: `${sampleId} 两项已恢复，已续到 ${open.id}，待处置人与复核人签认后关闭。` };
    } else if (verdict.overLimit) {
      const newTicketId = `T-${String(ticketSeq).padStart(4, "0")}`;
      const ticket: Ticket = {
        id: newTicketId,
        roomId: room.id,
        grade: room.grade,
        status: "open",
        openedAt: nowIso,
        closedAt: null,
        initialSampleId: sampleId,
        handler: null,
        reviewer: null,
      };
      tickets = [...state.tickets, ticket];
      ticketSeq += 1;
      kind = "initial";
      ticketId = newTicketId;
      nextBanner = {
        tone: "danger",
        text: `${sampleId} 超限，已为 ${room.id} 开立异常单 ${newTicketId}，原值已锁定留档。`,
      };
    } else {
      nextBanner = { tone: "ok", text: `${sampleId} 未超限，已按房间、等级、班次留档。` };
    }

    const sample: SampleRecord = {
      id: sampleId,
      roomId: room.id,
      grade: room.grade,
      particles: fields.particles,
      pressure: fields.pressure,
      shift: fields.shift,
      sampler: fields.sampler,
      sampledAt: nowIso,
      kind,
      ticketId,
    };

    setState({
      samples: [...state.samples, sample],
      tickets,
      seq: { sample: state.seq.sample + 1, ticket: ticketSeq },
    });
    setBanner(nextBanner);
  }

  function handleClose(ticketId: string, handler: string, reviewer: string) {
    const ticket = state.tickets.find((t) => t.id === ticketId);
    if (!ticket) return;
    // 关闭前再校验一次，防止界面状态过期
    if (!checkClosure(ticket, state.samples, handler, reviewer).canClose) return;
    const closedAt = new Date().toISOString();
    setState({
      ...state,
      tickets: state.tickets.map((t) =>
        t.id === ticketId ? { ...t, status: "closed", closedAt, handler, reviewer } : t
      ),
    });
    setBanner({ tone: "ok", text: `${ticketId} 已关闭，原值、复测与签认人已留档保存。` });
  }

  function exportArchive() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleanroom-archive-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetArchive() {
    if (!window.confirm("确定清空本机存档？全部采样与异常单将被删除。")) return;
    clearState();
    setState(emptyState());
    setBanner({ tone: "warn", text: "本机存档已清空。" });
  }

  const metrics = [
    { label: "未结异常", value: openTickets.length, cls: openTickets.length > 0 ? "status-danger" : "status-ok" },
    { label: "留档采样", value: state.samples.length, cls: "status-ok" },
    { label: "复测次数", value: retestCount, cls: "status-watch" },
    { label: "已关闭异常", value: closedTickets.length, cls: "status-ok" },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-09 · 洁净室超限处置台</p>
          <h1>超限处置台</h1>
          <p className="subtitle">
            采样按房间、等级、粒子数、压差与班次留档；读数一旦录入不可修改。超限自动开单，
            同房间未结异常期间新采样只续到原单；两项恢复且处置人与复核人不同，异常方可关闭，
            原值、复测与签认人全程留痕。
          </p>
        </div>
        <div className="stack-card">
          <span>判定标准（资料）</span>
          <strong>
            粒子上限按等级判定；压差 {PRESSURE_RANGE.min}–{PRESSURE_RANGE.max} Pa 为稳定
          </strong>
          <ul className="limit-list">
            {Object.entries(GRADE_PARTICLE_LIMITS).map(([grade, limit]) => (
              <li key={grade}>
                <span>{grade}</span>
                <span>≤ {fmtNum(limit)} 个/m³</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={m.cls} />
          </article>
        ))}
      </section>

      {banner && <p className={`banner banner-${banner.tone}`}>{banner.text}</p>}

      <section className="workspace">
        <div className="workspace-left">
          <SampleForm tickets={state.tickets} onSubmit={handleSample} />
        </div>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>处置中</p>
              <h2>未结异常单（{openTickets.length}）</h2>
            </div>
          </div>
          {openTickets.length === 0 && <p className="hint">当前没有未结异常。</p>}
          <div className="ticket-list">
            {openTickets.map((t) => (
              <TicketCard key={t.id} ticket={t} samples={state.samples} onClose={handleClose} />
            ))}
          </div>
        </section>
      </section>

      <section className="panel records">
        <div className="section-heading">
          <div>
            <p>已关闭留档</p>
            <h2>异常档案（{closedTickets.length}）</h2>
          </div>
        </div>
        {closedTickets.length === 0 && <p className="hint">暂无已关闭的异常单。</p>}
        <div className="ticket-list">
          {closedTickets.map((t) => (
            <TicketCard key={t.id} ticket={t} samples={state.samples} onClose={handleClose} />
          ))}
        </div>
      </section>

      <section className="panel records">
        <div className="section-heading">
          <div>
            <p>采样留档</p>
            <h2>全部采样（{state.samples.length}）</h2>
          </div>
          <div className="toolbar">
            <button onClick={exportArchive}>导出存档 JSON</button>
            <button className="danger-action" onClick={resetArchive}>
              清空存档
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>采样号</th>
                <th>房间</th>
                <th>等级</th>
                <th>粒子数（个/m³）</th>
                <th>压差（Pa）</th>
                <th>班次</th>
                <th>采样人</th>
                <th>去向</th>
              </tr>
            </thead>
            <tbody>
              {sortedSamples.map((s) => {
                const verdict = evaluateSample(s.grade, s.particles, s.pressure);
                return (
                  <tr key={s.id}>
                    <td>{fmtTime(s.sampledAt)}</td>
                    <td>{s.id}</td>
                    <td>{roomLabel(s.roomId)}</td>
                    <td>{s.grade}</td>
                    <td className={verdict.particleOver ? "value-over" : ""}>{fmtNum(s.particles)}</td>
                    <td className={verdict.pressureOver ? "value-over" : ""}>{s.pressure}</td>
                    <td>{s.shift}</td>
                    <td>{s.sampler}</td>
                    <td>
                      {KIND_LABEL[s.kind]}
                      {s.ticketId ? ` · ${s.ticketId}` : ""}
                    </td>
                  </tr>
                );
              })}
              {sortedSamples.length === 0 && (
                <tr>
                  <td colSpan={9} className="hint">
                    暂无采样记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default App;
