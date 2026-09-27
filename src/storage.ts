// 本机存档层：localStorage 读写与初始演示数据，与资料、判定、界面分开维护。
import type { ConsoleState, SampleRecord, Ticket } from "./data";

const STORAGE_KEY = "hxwl09-cleanroom-console-v1";

export function loadState(): ConsoleState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsoleState;
    if (!Array.isArray(parsed.samples) || !Array.isArray(parsed.tickets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: ConsoleState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时保持界面可继续操作
  }
}

export function clearState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}

export function emptyState(): ConsoleState {
  return { samples: [], tickets: [], seq: { sample: 1, ticket: 1 } };
}

// 首次进入时的演示数据：一张未结异常单、一张已关闭异常单、一条常规留档
export function seedState(): ConsoleState {
  const now = Date.now();
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString();

  const samples: SampleRecord[] = [
    {
      id: "S-0001",
      roomId: "CR-202",
      grade: "ISO 7",
      particles: 181000,
      pressure: 18.6,
      shift: "早班",
      sampler: "周岚",
      sampledAt: iso(420),
      kind: "routine",
      ticketId: null,
    },
    {
      id: "S-0002",
      roomId: "CR-102",
      grade: "ISO 6",
      particles: 86400,
      pressure: 12.4,
      shift: "早班",
      sampler: "周岚",
      sampledAt: iso(300),
      kind: "initial",
      ticketId: "T-0001",
    },
    {
      id: "S-0003",
      roomId: "CR-102",
      grade: "ISO 6",
      particles: 41200,
      pressure: 13.1,
      shift: "中班",
      sampler: "陈默",
      sampledAt: iso(160),
      kind: "retest",
      ticketId: "T-0001",
    },
    {
      id: "S-0004",
      roomId: "CR-201",
      grade: "ISO 6",
      particles: 96500,
      pressure: 17.2,
      shift: "晚班",
      sampler: "陈默",
      sampledAt: iso(1560),
      kind: "initial",
      ticketId: "T-0002",
    },
    {
      id: "S-0005",
      roomId: "CR-201",
      grade: "ISO 6",
      particles: 22800,
      pressure: 18.9,
      shift: "早班",
      sampler: "周岚",
      sampledAt: iso(1320),
      kind: "retest",
      ticketId: "T-0002",
    },
  ];

  const tickets: Ticket[] = [
    {
      id: "T-0001",
      roomId: "CR-102",
      grade: "ISO 6",
      status: "open",
      openedAt: iso(300),
      closedAt: null,
      initialSampleId: "S-0002",
      handler: null,
      reviewer: null,
    },
    {
      id: "T-0002",
      roomId: "CR-201",
      grade: "ISO 6",
      status: "closed",
      openedAt: iso(1560),
      closedAt: iso(1290),
      initialSampleId: "S-0004",
      handler: "王工",
      reviewer: "李工",
    },
  ];

  return { samples, tickets, seq: { sample: 6, ticket: 3 } };
}
