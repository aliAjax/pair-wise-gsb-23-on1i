// 本机存档层：只追加（append-only）事件日志 + 哈希链。
// 采样一旦提交即不可修改、不可删除，复测只能追加；异常单的原值、复测、签认因此无法被“合理读数”盖掉。
// 状态全部由事件重放得到，本层不提供任何改写历史的入口。

import { ROOMS, roomByCode, SHIFTS } from "./catalog";
import {
  GRADES,
  RULES_VERSION,
  evaluateClose,
  evaluateSample,
  type GradeId,
  type Shift,
  type Verdict,
} from "./rules";

// ---- 数据模型 ----

export interface Sample {
  id: string;
  roomCode: string;
  grade: GradeId;
  p05: number;
  p5: number;
  dp: number;
  shift: Shift;
  operator: string;
  note: string;
  ts: number;
  kind: "首次采样" | "复测";
  ticketId: string | null;
  verdict: Verdict;
}

export interface TicketNote {
  at: number;
  actor: string;
  text: string;
}

export interface CloseRecord {
  at: number;
  disposer: string;
  reviewer: string;
  checks: { id: string; label: string; pass: boolean; detail: string }[];
}

export interface Ticket {
  id: string;
  roomCode: string;
  grade: GradeId;
  status: "未结" | "已关闭";
  openedAt: number;
  originSampleId: string;
  retestIds: string[];
  notes: TicketNote[];
  close: CloseRecord | null;
}

export interface State {
  samples: Sample[];
  tickets: Record<string, Ticket>;
  ticketOrder: string[];
}

// ---- 事件日志条目 ----

export interface SamplePayload {
  id: string;
  roomCode: string;
  grade: GradeId;
  p05: number;
  p5: number;
  dp: number;
  shift: Shift;
  operator: string;
  note: string;
  ts: number;
  kind: "首次采样" | "复测";
  ticketId: string | null;
  verdict: Verdict;
}

export interface NotePayload {
  ticketId: string;
  at: number;
  actor: string;
  text: string;
}

export interface ClosePayload {
  ticketId: string;
  at: number;
  disposer: string;
  reviewer: string;
  checks: CloseRecord["checks"];
}

export type EntryType = "sample" | "note" | "close";
export type EntryPayload = SamplePayload | NotePayload | ClosePayload;

export interface Entry<T extends EntryPayload = EntryPayload> {
  seq: number;
  ts: number;
  type: EntryType;
  payload: T;
  prevHash: string;
  hash: string;
}

// ---- 哈希链 ----

// cyrb53：为每条事件生成校验指纹，前一条指纹参与下一条计算
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h2 >>> 0).toString(16).padStart(8, "0");
  const lo = ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0");
  return hi + lo;
}

const GENESIS = "0".repeat(16);

function seal(
  seq: number,
  ts: number,
  type: EntryType,
  payload: EntryPayload,
  prevHash: string
): Entry {
  const basis = JSON.stringify({ seq, ts, type, payload, prevHash });
  return { seq, ts, type, payload, prevHash, hash: cyrb53(basis) };
}

export function verifyChain(log: Entry[]): { ok: boolean; brokenAt: number | null } {
  let prev = GENESIS;
  for (const entry of log) {
    const basis = JSON.stringify({
      seq: entry.seq,
      ts: entry.ts,
      type: entry.type,
      payload: entry.payload,
      prevHash: prev,
    });
    if (entry.prevHash !== prev || entry.hash !== cyrb53(basis)) {
      return { ok: false, brokenAt: entry.seq };
    }
    prev = entry.hash;
  }
  return { ok: true, brokenAt: null };
}

// ---- 重放 ----

export function emptyState(): State {
  return { samples: [], tickets: {}, ticketOrder: [] };
}

export function derive(log: Entry[]): State {
  const state = emptyState();

  for (const entry of log) {
    const p = entry.payload;
    if (entry.type === "sample") {
      const payload = p as SamplePayload;
      state.samples.push({ ...payload });

      if (payload.ticketId) {
        // 单号在提交时已确定性写入（房间-日期-序号）；重放遇到首个采样时重建异常单
        if (!state.tickets[payload.ticketId]) {
          state.ticketOrder.push(payload.ticketId);
          state.tickets[payload.ticketId] = {
            id: payload.ticketId,
            roomCode: payload.roomCode,
            grade: payload.grade,
            status: "未结",
            openedAt: payload.ts,
            originSampleId: payload.id,
            retestIds: [],
            notes: [],
            close: null,
          };
        } else if (payload.kind === "复测") {
          state.tickets[payload.ticketId].retestIds.push(payload.id);
        }
      }
    } else if (entry.type === "note") {
      const payload = p as NotePayload;
      state.tickets[payload.ticketId].notes.push({
        at: payload.at,
        actor: payload.actor,
        text: payload.text,
      });
    } else if (entry.type === "close") {
      const payload = p as ClosePayload;
      const ticket = state.tickets[payload.ticketId];
      ticket.status = "已关闭";
      ticket.close = {
        at: payload.at,
        disposer: payload.disposer,
        reviewer: payload.reviewer,
        checks: payload.checks,
      };
    }
  }

  state.samples.sort((a, b) => a.ts - b.ts);
  return state;
}

// ---- 时间/编号 ----

export function localDateOf(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${m}-${day} ${hh}:${mm}`;
}

function nextTicketId(state: State, roomCode: string, ts: number): string {
  const day = localDateOf(ts);
  const prefix = `${roomCode}-${day}-`;
  const count = state.ticketOrder.filter((id) => id.startsWith(prefix)).length;
  return `${prefix}${String(count + 1).padStart(2, "0")}`;
}

function nextSampleId(state: State): string {
  // 按事件序号全局唯一，回填历史时间也不会与旧记录撞号
  return `SP-${String(state.samples.length + 1).padStart(4, "0")}`;
}

function openTicketOf(state: State, roomCode: string): Ticket | null {
  const id = state.ticketOrder.find(
    (tid) => state.tickets[tid].roomCode === roomCode && state.tickets[tid].status === "未结"
  );
  return id ? state.tickets[id] : null;
}

// ---- 写操作（均为追加事件） ----

export interface SampleInput {
  roomCode: string;
  grade?: GradeId;
  p05: number;
  p5: number;
  dp: number;
  shift: Shift;
  operator: string;
  note?: string;
  ts?: number;
}

function assertMeasure(input: SampleInput, grade: GradeId): void {
  roomByCode(input.roomCode);
  if (!GRADES.some((g) => g.id === grade)) throw new Error("洁净等级无效");
  if (!SHIFTS.includes(input.shift)) throw new Error("班次无效");
  if (!input.operator.trim()) throw new Error("采样人必须签名");
  for (const [label, v] of [
    ["≥0.5μm 粒子数", input.p05],
    ["≥5.0μm 粒子数", input.p5],
    ["压差", input.dp],
  ] as const) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(`${label}必须是不小于 0 的数字`);
    }
  }
}

/**
 * 提交采样留档。
 * 同房间存在未结异常单时，新采样自动续到该单（作为复测）；合格也不另开新单。
 * 首次超限自动建单；合格且无未结单则只留台账。
 */
export function submitSample(log: Entry[], input: SampleInput): Entry<SamplePayload> {
  const state = derive(log);
  const ts = input.ts ?? Date.now();
  const room = roomByCode(input.roomCode);
  const grade = input.grade ?? room.grade;
  assertMeasure(input, grade);

  const verdict = evaluateSample({ grade, p05: input.p05, p5: input.p5, dp: input.dp });
  const openTicket = openTicketOf(state, room.code);
  const kind: Sample["kind"] = openTicket ? "复测" : "首次采样";

  let ticketId: string | null = openTicket?.id ?? null;
  if (!openTicket && !verdict.pass) {
    ticketId = nextTicketId(state, room.code, ts);
  }

  const id = nextSampleId(state);
  const payload: SamplePayload = {
    id,
    roomCode: room.code,
    grade,
    p05: input.p05,
    p5: input.p5,
    dp: input.dp,
    shift: input.shift,
    operator: input.operator,
    note: input.note?.trim() ?? "",
    ts,
    kind,
    ticketId,
    verdict,
  };

  return seal(log.length, ts, "sample", payload, log.at(-1)?.hash ?? GENESIS) as Entry<SamplePayload>;
}

export interface NoteInput {
  ticketId: string;
  actor: string;
  text: string;
  ts?: number;
}

export function addNote(log: Entry[], input: NoteInput): Entry<NotePayload> {
  const state = derive(log);
  const ticket = state.tickets[input.ticketId];
  if (!ticket) throw new Error("异常单不存在");
  if (ticket.status === "已关闭") throw new Error("异常单已关闭，处置记录不可再追加");
  if (!input.actor.trim()) throw new Error("记录人必须签名");
  if (!input.text.trim()) throw new Error("处置说明不能为空");

  const payload: NotePayload = {
    ticketId: ticket.id,
    at: input.ts ?? Date.now(),
    actor: input.actor.trim(),
    text: input.text.trim(),
  };
  return seal(log.length, payload.at, "note", payload, log.at(-1)?.hash ?? GENESIS) as Entry<NotePayload>;
}

export interface CloseInputBody {
  ticketId: string;
  disposer: string;
  reviewer: string;
  ts?: number;
}

/** 关闭异常单：复测后粒子与压差均恢复，且处置人 ≠ 复核人，才允许追加关闭事件。 */
export function closeTicket(log: Entry[], input: CloseInputBody): Entry<ClosePayload> {
  const state = derive(log);
  const ticket = state.tickets[input.ticketId];
  if (!ticket) throw new Error("异常单不存在");
  if (ticket.status === "已关闭") throw new Error("异常单已关闭");

  const latestRetest = ticket.retestIds
    .map((sid) => state.samples.find((s) => s.id === sid)!)
    .filter(Boolean)
    .sort((a, b) => b.ts - a.ts)[0];

  const verdict = evaluateClose({
    hasRetest: ticket.retestIds.length > 0,
    latest: latestRetest
      ? { particlePass: latestRetest.verdict.particlePass, pressurePass: latestRetest.verdict.pressurePass }
      : null,
    disposer: input.disposer,
    reviewer: input.reviewer,
  });
  if (!verdict.ok) {
    throw new Error(verdict.checks.filter((c) => !c.pass).map((c) => c.label).join("；"));
  }

  const payload: ClosePayload = {
    ticketId: ticket.id,
    at: input.ts ?? Date.now(),
    disposer: input.disposer.trim(),
    reviewer: input.reviewer.trim(),
    checks: verdict.checks.map((c) => ({ id: c.id, label: c.label, pass: c.pass, detail: c.detail })),
  };
  return seal(log.length, payload.at, "close", payload, log.at(-1)?.hash ?? GENESIS) as Entry<ClosePayload>;
}

// ---- 派生查询 ----

export function ticketSamples(state: State, ticket: Ticket): Sample[] {
  return [ticket.originSampleId, ...ticket.retestIds]
    .map((sid) => state.samples.find((s) => s.id === sid))
    .filter((s): s is Sample => !!s)
    .sort((a, b) => a.ts - b.ts);
}

export function latestRetest(state: State, ticket: Ticket): Sample | null {
  const found = ticketSamples(state, ticket).filter((s) => s.kind === "复测");
  return found.length ? found[found.length - 1] : null;
}

export const RULES_SNAPSHOT_VERSION = RULES_VERSION;
export const ARCHIVE_VERSION = "archive-v1";

// ---- 本机持久化 ----

const STORAGE_KEY = "cleanroom-console:log:v1";

export function loadLog(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version: string; entries: Entry[] };
    if (parsed.version !== ARCHIVE_VERSION || !Array.isArray(parsed.entries)) return [];
    return parsed.entries;
  } catch {
    return [];
  }
}

export function saveLog(log: Entry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: ARCHIVE_VERSION, entries: log }));
}

export function clearStoredLog(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportLog(log: Entry[]): string {
  return JSON.stringify(
    {
      archiveVersion: ARCHIVE_VERSION,
      rulesVersion: RULES_VERSION,
      exportedAt: new Date().toISOString(),
      integrity: verifyChain(log),
      entries: log,
    },
    null,
    2
  );
}

// ---- 教学样例数据（固定时间戳，便于演示“原单续测、双签关闭”） ----

function demoTs(text: string): number {
  return new Date(text.replace(" ", "T")).getTime();
}

export function makeDemoLog(): Entry[] {
  let log: Entry[] = [];
  const push = (entry: Entry) => {
    log = [...log, entry];
  };

  push(submitSample(log, {
    roomCode: "CR-1201",
    p05: 2100, p5: 8, dp: 18,
    shift: "早班", operator: "值班员·周敏",
    note: "常态巡检，数据平稳",
    ts: demoTs("2026-09-26 09:12"),
  }));

  push(submitSample(log, {
    roomCode: "CR-1201",
    p05: 6100, p5: 41, dp: 12,
    shift: "中班", operator: "值班员·陈岩",
    note: "巡检发现粒子与压差同时异常，立即上报",
    ts: demoTs("2026-09-26 14:40"),
  }));
  const t1 = (derive(log).ticketOrder)[0];

  push(addNote(log, {
    ticketId: t1, actor: "厂务工程师·高磊",
    text: "初判高效过滤器送风段异常，该间停用，安排更换过滤器",
    ts: demoTs("2026-09-26 15:05"),
  }));
  push(submitSample(log, {
    roomCode: "CR-1201",
    p05: 4300, p5: 31, dp: 14,
    shift: "中班", operator: "值班员·陈岩",
    note: "更换过滤器后第一次复测",
    ts: demoTs("2026-09-26 16:20"),
  }));
  push(addNote(log, {
    ticketId: t1, actor: "厂务工程师·高磊",
    text: "粒子仍超 ISO 5 上限、压差仍低于 15Pa；延长自净时间并检查门封",
    ts: demoTs("2026-09-26 16:40"),
  }));
  push(submitSample(log, {
    roomCode: "CR-1201",
    p05: 2600, p5: 12, dp: 17,
    shift: "早班", operator: "值班员·周敏",
    note: "延长自净后复测，等待双签关闭",
    ts: demoTs("2026-09-27 08:50"),
  }));

  push(submitSample(log, {
    roomCode: "CR-2107",
    p05: 41000, p5: 120, dp: 20,
    shift: "早班", operator: "值班员·周敏",
    note: "粒子数超限，压差尚稳定",
    ts: demoTs("2026-09-26 10:05"),
  }));
  const t2 = derive(log).ticketOrder.find((id) => id.startsWith("CR-2107"))!;

  push(addNote(log, {
    ticketId: t2, actor: "厂务工程师·高磊",
    text: "风淋互锁失效导致开门时间过长，挂牌停用并报修",
    ts: demoTs("2026-09-26 10:40"),
  }));
  push(submitSample(log, {
    roomCode: "CR-2107",
    p05: 18000, p5: 90, dp: 21,
    shift: "中班", operator: "值班员·陈岩",
    note: "互锁修复后复测",
    ts: demoTs("2026-09-26 15:30"),
  }));
  push(addNote(log, {
    ticketId: t2, actor: "厂务工程师·高磊",
    text: "互锁修复，复测粒子与压差均恢复，提请关闭",
    ts: demoTs("2026-09-26 17:02"),
  }));
  push(closeTicket(log, {
    ticketId: t2,
    disposer: "厂务工程师·高磊",
    reviewer: "班组长·林岚",
    ts: demoTs("2026-09-26 17:20"),
  }));

  push(submitSample(log, {
    roomCode: "CR-3302",
    p05: 120000, p5: 800, dp: 14,
    shift: "夜班", operator: "值班员·陈岩",
    note: "压差 14Pa 跌破稳定区间，粒子尚在 ISO 7 上限内",
    ts: demoTs("2026-09-27 07:55"),
  }));
  const t3 = derive(log).ticketOrder.find((id) => id.startsWith("CR-3302"))!;
  push(addNote(log, {
    ticketId: t3, actor: "厂务工程师·高磊",
    text: "回风阀松动导致压差下滑，现场调校，待复测",
    ts: demoTs("2026-09-27 08:20"),
  }));

  push(submitSample(log, {
    roomCode: "CR-4105",
    p05: 800000, p5: 3000, dp: 22,
    shift: "早班", operator: "值班员·周敏",
    note: "常态巡检合格",
    ts: demoTs("2026-09-27 09:02"),
  }));

  return log;
}

export { ROOMS };
