// 判定层：洁净等级粒子上限、压差稳定区间、超限判定与异常关闭条件
// 本文件是唯一的“判定标准”维护点，界面与存档只调用这里的纯函数，不自行判定。

export type GradeId = "ISO5" | "ISO6" | "ISO7" | "ISO8";
export type Shift = "早班" | "中班" | "夜班";

export interface GradeRule {
  id: GradeId;
  name: string;
  /** 空气中悬浮粒子最大允许数，粒/m³ */
  limits: { p05: number; p5: number };
  basis: string;
}

// ISO 14644-1:2015 表1 各级别空气悬浮粒子浓度限值（粒/m³）
export const GRADES: GradeRule[] = [
  {
    id: "ISO5",
    name: "ISO 5 级",
    limits: { p05: 3520, p5: 29 },
    basis: "ISO 14644-1:2015：≥0.5μm 3 520；≥5.0μm 29",
  },
  {
    id: "ISO6",
    name: "ISO 6 级",
    limits: { p05: 35200, p5: 293 },
    basis: "ISO 14644-1:2015：≥0.5μm 35 200；≥5.0μm 293",
  },
  {
    id: "ISO7",
    name: "ISO 7 级",
    limits: { p05: 352000, p5: 2930 },
    basis: "ISO 14644-1:2015：≥0.5μm 352 000；≥5.0μm 2 930",
  },
  {
    id: "ISO8",
    name: "ISO 8 级",
    limits: { p05: 3520000, p5: 29300 },
    basis: "ISO 14644-1:2015：≥0.5μm 3 520 000；≥5.0μm 29 300",
  },
];

export const RULES_VERSION = "ISO 14644-1:2015 / 厂规 V1.0";

// 压差稳定区间：15–25Pa（含边界）
export const PRESSURE_RULE = {
  min: 15,
  max: 25,
  unit: "Pa",
  description: "相邻房间静压差在 15–25Pa 之间判为稳定",
};

export function gradeRule(id: GradeId): GradeRule {
  const rule = GRADES.find((g) => g.id === id);
  if (!rule) throw new Error(`未知洁净等级：${id}`);
  return rule;
}

export interface Verdict {
  particlePass: boolean;
  pressurePass: boolean;
  pass: boolean;
  /** 判定当时的标准快照，标准修订后历史记录仍可追溯 */
  limits: {
    rulesVersion: string;
    grade: GradeId;
    p05: number;
    p5: number;
    dpMin: number;
    dpMax: number;
  };
  failures: string[];
}

export interface SampleMeasure {
  grade: GradeId;
  /** ≥0.5μm 粒子数，粒/m³ */
  p05: number;
  /** ≥5.0μm 粒子数，粒/m³ */
  p5: number;
  /** 静压差，Pa */
  dp: number;
}

/** 粒子上限按等级判定；压差 15–25Pa 才算稳定。任一项不合格则整体超限。 */
export function evaluateSample(m: SampleMeasure): Verdict {
  const rule = gradeRule(m.grade);
  const failures: string[] = [];

  const particleReasons: string[] = [];
  if (m.p05 > rule.limits.p05) {
    particleReasons.push(
      `≥0.5μm 粒子 ${m.p05.toLocaleString()} ＞上限 ${rule.limits.p05.toLocaleString()} 粒/m³`
    );
  }
  if (m.p5 > rule.limits.p5) {
    particleReasons.push(
      `≥5.0μm 粒子 ${m.p5.toLocaleString()} ＞上限 ${rule.limits.p5.toLocaleString()} 粒/m³`
    );
  }
  const particlePass = particleReasons.length === 0;
  failures.push(...particleReasons);

  const pressurePass = m.dp >= PRESSURE_RULE.min && m.dp <= PRESSURE_RULE.max;
  if (!pressurePass) {
    failures.push(
      m.dp < PRESSURE_RULE.min
        ? `压差 ${m.dp}Pa 低于稳定下限 ${PRESSURE_RULE.min}Pa`
        : `压差 ${m.dp}Pa 高于稳定上限 ${PRESSURE_RULE.max}Pa`
    );
  }

  return {
    particlePass,
    pressurePass,
    pass: particlePass && pressurePass,
    limits: {
      rulesVersion: RULES_VERSION,
      grade: m.grade,
      p05: rule.limits.p05,
      p5: rule.limits.p5,
      dpMin: PRESSURE_RULE.min,
      dpMax: PRESSURE_RULE.max,
    },
    failures,
  };
}

export interface CloseCheckItem {
  id: "retest" | "particle" | "pressure" | "people";
  label: string;
  pass: boolean;
  detail: string;
}

export interface CloseVerdict {
  ok: boolean;
  checks: CloseCheckItem[];
}

export interface CloseInput {
  hasRetest: boolean;
  latest?: { particlePass: boolean; pressurePass: boolean } | null;
  disposer: string;
  reviewer: string;
}

/**
 * 异常关闭条件：
 * 1) 至少有一次复测；
 * 2) 最新复测粒子数按等级恢复到上限内；
 * 3) 最新复测压差回到 15–25Pa 稳定区间（两项须在同一次复测同时恢复）；
 * 4) 处置人与复核人都已签名且不能是同一人。
 */
export function evaluateClose(input: CloseInput): CloseVerdict {
  const d = input.disposer.trim();
  const r = input.reviewer.trim();
  const peoplePass = d.length > 0 && r.length > 0 && d !== r;

  const checks: CloseCheckItem[] = [
    {
      id: "retest",
      label: "已有复测记录",
      pass: input.hasRetest,
      detail: input.hasRetest ? "已登记复测" : "尚无复测，不能关闭",
    },
    {
      id: "particle",
      label: "最新复测粒子合格",
      pass: !!input.latest && input.latest.particlePass,
      detail: !input.latest
        ? "等待复测"
        : input.latest.particlePass
          ? "粒子数已回到等级上限内"
          : "最新复测粒子仍超限",
    },
    {
      id: "pressure",
      label: "最新复测压差稳定（15–25Pa）",
      pass: !!input.latest && input.latest.pressurePass,
      detail: !input.latest
        ? "等待复测"
        : input.latest.pressurePass
          ? "压差处于 15–25Pa 稳定区间"
          : "最新复测压差未稳定",
    },
    {
      id: "people",
      label: "处置人与复核人不同",
      pass: peoplePass,
      detail:
        d.length === 0 || r.length === 0
          ? "处置人与复核人均须签名"
          : d === r
            ? "处置人与复核人不能是同一人"
            : `${d} 处置 / ${r} 复核`,
    },
  ];

  return { ok: checks.every((c) => c.pass), checks };
}
