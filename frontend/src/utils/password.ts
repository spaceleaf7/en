/** 密码强度规则，与 LoginPage 和后端 validate_password 保持一致 */

export interface PasswordRule {
  key: string;
  label: string;
  test: (v: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { key: 'length', label: '至少 8 个字符', test: (v) => v.length >= 8 },
  { key: 'letter', label: '包含英文字母', test: (v) => /[A-Za-z]/.test(v) },
  { key: 'digit', label: '包含数字', test: (v) => /\d/.test(v) },
];

/** 返回第一条未通过的规则描述，全部通过返回 null */
export function validatePassword(v: string): string | null {
  for (const r of PASSWORD_RULES) {
    if (!r.test(v)) return r.label;
  }
  return null;
}

export function isPasswordValid(v: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(v));
}
