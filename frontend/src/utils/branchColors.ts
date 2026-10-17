/** 彩虹分支配色：连线与单词节点共用，按单词在词根下的顺序依次取色 */
export const RAINBOW_COLORS = [
  '#ef4444', // 红
  '#f97316', // 橙
  '#eab308', // 黄
  '#22c55e', // 绿
  '#06b6d4', // 青
  '#3b82f6', // 蓝
  '#8b5cf6', // 紫
];

export function getBranchColor(index: number): string {
  return RAINBOW_COLORS[index % RAINBOW_COLORS.length];
}
