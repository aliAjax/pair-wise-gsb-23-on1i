// 资料层：房间、等级、限值、班次等基础资料与类型定义。
// 与判定（rules.ts）、本机存档（storage.ts）、界面（App.tsx）分开维护。

export interface Room {
  id: string;
  name: string;
  grade: string;
  zone: string;
}

export const ROOMS: Room[] = [
  { id: "CR-101", name: "光刻间", grade: "ISO 5", zone: "黄光区" },
  { id: "CR-102", name: "蚀刻间", grade: "ISO 6", zone: "湿法区" },
  { id: "CR-201", name: "扩散间", grade: "ISO 6", zone: "扩散区" },
  { id: "CR-202", name: "薄膜间", grade: "ISO 7", zone: "沉积区" },
  { id: "CR-301", name: "清洗间", grade: "ISO 7", zone: "湿法区" },
  { id: "CR-302", name: "封装间", grade: "ISO 8", zone: "后段区" },
];

// ≥0.5µm 粒子上限（个/m³），按 ISO 14644-1 等级判定
export const GRADE_PARTICLE_LIMITS: Record<string, number> = {
  "ISO 5": 3520,
  "ISO 6": 35200,
  "ISO 7": 352000,
  "ISO 8": 3520000,
};

// 压差稳定区间（Pa）：低于下限或高于上限均判不稳定
export const PRESSURE_RANGE = { min: 15, max: 25 } as const;

export const SHIFTS = ["早班", "中班", "晚班"] as const;
export type Shift = (typeof SHIFTS)[number];

// routine=常规留档；initial=异常单原值；retest=续到异常单上的复测
export type SampleKind = "routine" | "initial" | "retest";

export interface SampleRecord {
  id: string;
  roomId: string;
  grade: string;
  particles: number;
  pressure: number;
  shift: Shift;
  sampler: string;
  sampledAt: string;
  kind: SampleKind;
  ticketId: string | null;
}

export type TicketStatus = "open" | "closed";

export interface Ticket {
  id: string;
  roomId: string;
  grade: string;
  status: TicketStatus;
  openedAt: string;
  closedAt: string | null;
  initialSampleId: string;
  handler: string | null;
  reviewer: string | null;
}

export interface ConsoleState {
  samples: SampleRecord[];
  tickets: Ticket[];
  seq: { sample: number; ticket: number };
}
