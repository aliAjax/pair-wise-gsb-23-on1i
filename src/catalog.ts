// 资料层：房间台账与班次/人员名册。
// 基础资料在这里独立维护；改房间或人员不影响判定标准与历史存档。

import type { GradeId } from "./rules";

export interface Room {
  code: string;
  name: string;
  grade: GradeId;
}

// 房间按其设计洁净等级登记；采样时带出默认等级
export const ROOMS: Room[] = [
  { code: "CR-1201", name: "光刻区·涂胶间", grade: "ISO5" },
  { code: "CR-1204", name: "光刻区·曝光间", grade: "ISO5" },
  { code: "CR-2107", name: "刻蚀区·反应间", grade: "ISO6" },
  { code: "CR-3302", name: "薄膜区·沉积间", grade: "ISO7" },
  { code: "CR-4105", name: "封装区·清洗间", grade: "ISO8" },
  { code: "Y-0302", name: "黄光区·周转间", grade: "ISO8" },
];

export const SHIFTS = ["早班", "中班", "夜班"] as const;

export const OPERATORS = ["值班员·周敏", "值班员·陈岩", "厂务工程师·高磊", "班组长·林岚"];

export function roomByCode(code: string): Room {
  const room = ROOMS.find((r) => r.code === code);
  if (!room) throw new Error(`房间台账中不存在：${code}`);
  return room;
}
