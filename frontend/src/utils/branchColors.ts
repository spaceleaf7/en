/** 彩虹分支配色：连线与单词节点共用，按单词在词根下的顺序依次取色 */
export const RAINBOW_COLORS = [
  '#2563eb', // 蓝
  '#8b5cf6', // 紫
  '#06b6d4', // 青
  '#f59e0b', // 琥珀
  '#ec4899', // 粉
];

export function getBranchColor(index: number): string {
  return RAINBOW_COLORS[index % RAINBOW_COLORS.length];
}
