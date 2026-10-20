export const Phase = { Lobby: 0, Ready: 1, Playing: 2, Goal: 3, Ended: 4 } as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

// 手柄按键位：A 传球 / B 射门（长按蓄力）/ X 冲刺 / Y 铲球
export const BTN_A = 1;
export const BTN_B = 2;
export const BTN_X = 4;
export const BTN_Y = 8;

export const FLAG_SPRINT = 1;
export const FLAG_TACKLE = 2;
export const FLAG_STUN = 4;
export const FLAG_CHARGE = 8;

export type Team = 0 | 1; // 0 红队（左侧，向右进攻） 1 蓝队（右侧）

export interface Input {
  jx: number; // -1..1
  jy: number;
  btn: number;
}

export interface PlayerInfo {
  id: number;
  name: string;
  team: Team;
  num: number;
  bot: boolean;
  online: boolean;
  link: 'p2p' | 'relay' | 'bot' | 'local';
}

export interface SnapPlayer {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  flags: number;
  stamina: number; // 0..1
  charge: number; // 0..1
}

export interface Snapshot {
  tick: number;
  phase: Phase;
  score: [number, number];
  timeLeft: number; // 秒
  phaseTime: number; // 当前阶段已持续秒数
  ball: { x: number; y: number; vx: number; vy: number };
  players: SnapPlayer[];
}

/** 比赛时长可选值（秒）：设置界面与主机校验共用 */
export const DURATIONS = [60, 120, 180, 300];

/** AI 难度：0 简单 1 普通 2 困难 */
export const BOT_LEVELS = [0, 1, 2] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

export interface Settings {
  duration: number; // 秒
  /** 自动补位：AI 把人少的一队补到与人多的一队相同 */
  autoFill: boolean;
  /** 手动模式下每队的 AI 数量 */
  bots: [number, number];
  level: BotLevel;
}

export interface EndInfo {
  score: [number, number];
  winner: Team | -1;
  reason: EndReason;
}

/** 结束原因与拒绝原因只传代码，由各端按自己的语言显示 */
export type EndReason = 'time' | 'host' | 'surrender';
export type RejectReason = 'pinWrong' | 'pinNeed' | 'pinThrottle' | 'full' | 'watchFull' | 'notFound' | 'kicked'; // notFound 由客户端超时判定

export interface RosterMsg {
  t: 'roster';
  players: PlayerInfo[];
  settings: Settings;
  /** 各队已同意投降的球员 id */
  votes: [number[], number[]];
  /** 各队投降所需票数 */
  need: [number, number];
  end: EndInfo | null;
  /** 房主的球员 id（只有房主能开始比赛、改设置、增减 AI），没有则为 -1 */
  hostPid: number;
  /** 观战人数 */
  watchers: number;
}

/** 可靠通道 JSON 消息（主机 -> 客户端） */
export type HostMsg =
  /** pid 为 -1 表示以观战者身份进入 */
  | { t: 'welcome'; pid: number }
  | { t: 'reject'; reason: RejectReason }
  | RosterMsg
  | { t: 'ev'; k: 'goal'; team: Team; scorer: string; own: boolean }
  | { t: 'ev'; k: 'kick' }
  | { t: 'ev'; k: 'tackled' }
  | ({ t: 'ev'; k: 'end' } & EndInfo)
  | { t: 'ev'; k: 'vote'; team: Team; name: string; n: number; need: number; cancel: boolean }
  /** 观战者申请上场时两队都满了 */
  | { t: 'ev'; k: 'full' }
  | { t: 'pong'; ts: number };

/** 可靠通道 JSON 消息（客户端 -> 主机） */
export type ClientMsg =
  | { t: 'team'; team: Team }
  | { t: 'name'; name: string }
  | { t: 'start' }
  | { t: 'surrender' }
  | { t: 'settings'; patch: Partial<Settings> }
  | { t: 'bot'; team: Team; delta: 1 | -1 }
  | { t: 'kick'; pid: number }
  | { t: 'owner'; pid: number }
  /** 观战者上场（team 为 auto 时自动分队） / 球员下场观战 */
  | { t: 'play'; team: Team | 'auto' }
  | { t: 'watch' }
  | { t: 'ping'; ts: number };
