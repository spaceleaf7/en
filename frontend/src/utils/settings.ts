import type { StudySettings } from '../types/progress';

export interface GoalLimit {
  label: string;
  unit: string;
  min: number;
  max: number;
}

/** 取值范围与后端 schemas.SettingsIn 保持一致 */
export const GOAL_LIMITS: Record<keyof StudySettings, GoalLimit> = {
  dailyNewGoal: { label: '每日新词', unit: '词', min: 1, max: 200 },
  dailyMinutesGoal: { label: '每日学习时长', unit: '分钟', min: 1, max: 600 },
};

/** 与后端 schemas.SettingsIn.nickname 一致：去掉首尾空格后 1-32 位 */
export const NICKNAME_MAX = 32;

export function validateNickname(text: string): string | null {
  const t = text.trim();
  if (!t) return '昵称不能为空';
  if (t.length > NICKNAME_MAX) return `昵称最多 ${NICKNAME_MAX} 个字`;
  return null;
}

/** 浏览器当前时区；学习日按它切分，每次同步时上报给服务端 */
export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** 校验输入框中的文本，通过时返回 null，否则返回错误提示 */
export function validateGoal(key: keyof StudySettings, text: string): string | null {
  const { label, min, max } = GOAL_LIMITS[key];
  const t = text.trim();
  if (!t) return `请填写${label}`;
  if (!/^\d+$/.test(t)) return `${label}需为整数`;
  const n = Number(t);
  if (n < min || n > max) return `${label}需在 ${min}-${max} 之间`;
  return null;
}
