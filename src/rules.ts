// 判定层：超限判定、续单归属、关闭条件。全部为纯函数，不依赖界面与存档。
import { GRADE_PARTICLE_LIMITS, PRESSURE_RANGE } from "./data";
import type { SampleRecord, Ticket } from "./data";

export interface SampleVerdict {
  limit: number;
  particleOver: boolean;
  pressureOver: boolean;
  overLimit: boolean;
}

export function particleLimitFor(grade: string): number {
  return GRADE_PARTICLE_LIMITS[grade] ?? Number.POSITIVE_INFINITY;
}

// 粒子上限按等级判定；压差在 15–25 Pa 才算稳定
export function evaluateSample(grade: string, particles: number, pressure: number): SampleVerdict {
  const limit = particleLimitFor(grade);
  const particleOver = particles > limit;
  const pressureOver = pressure < PRESSURE_RANGE.min || pressure > PRESSURE_RANGE.max;
  return { limit, particleOver, pressureOver, overLimit: particleOver || pressureOver };
}

// 同房间还有未结异常时，新采样只续到那张单上
export function findOpenTicket(tickets: Ticket[], roomId: string): Ticket | undefined {
  return tickets.find((t) => t.roomId === roomId && t.status === "open");
}

// 一张单上的全部采样（原值 + 复测），按时间升序
export function ticketSamples(ticket: Ticket, samples: SampleRecord[]): SampleRecord[] {
  return samples
    .filter((s) => s.ticketId === ticket.id)
    .sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
}

export function latestTicketSample(ticket: Ticket, samples: SampleRecord[]): SampleRecord | undefined {
  const chain = ticketSamples(ticket, samples);
  return chain[chain.length - 1];
}

export interface ClosureCheck {
  particleRecovered: boolean;
  pressureRecovered: boolean;
  bothRecovered: boolean;
  signersReady: boolean;
  signersDistinct: boolean;
  canClose: boolean;
  reasons: string[];
}

// 关闭条件：最近复测两项均恢复，且处置人与复核人不同
export function checkClosure(
  ticket: Ticket,
  samples: SampleRecord[],
  handler: string,
  reviewer: string
): ClosureCheck {
  const latest = latestTicketSample(ticket, samples);
  const verdict = latest ? evaluateSample(latest.grade, latest.particles, latest.pressure) : null;

  const particleRecovered = verdict !== null && !verdict.particleOver;
  const pressureRecovered = verdict !== null && !verdict.pressureOver;
  const bothRecovered = particleRecovered && pressureRecovered;

  const handlerName = handler.trim();
  const reviewerName = reviewer.trim();
  const signersReady = handlerName.length > 0 && reviewerName.length > 0;
  const signersDistinct = signersReady && handlerName !== reviewerName;

  const reasons: string[] = [];
  if (!latest) {
    reasons.push("尚无复测记录，不能关闭");
  } else {
    if (!particleRecovered) {
      reasons.push(
        `粒子仍超限（最近复测 ${latest.particles.toLocaleString("zh-CN")} > 上限 ${verdict!.limit.toLocaleString("zh-CN")}）`
      );
    }
    if (!pressureRecovered) {
      reasons.push(
        `压差未回到 ${PRESSURE_RANGE.min}–${PRESSURE_RANGE.max} Pa（最近复测 ${latest.pressure} Pa）`
      );
    }
  }
  if (!signersReady) {
    reasons.push("需填写处置人与复核人");
  } else if (!signersDistinct) {
    reasons.push("处置人与复核人不能为同一人");
  }

  return {
    particleRecovered,
    pressureRecovered,
    bothRecovered,
    signersReady,
    signersDistinct,
    canClose: bothRecovered && signersDistinct,
    reasons,
  };
}
