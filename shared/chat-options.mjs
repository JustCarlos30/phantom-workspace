export const EFFORTS = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
};
export function validReasoning(provider, value) {
  return typeof value === 'string' && (provider === 'opencode'
    ? /^[A-Za-z0-9][\w-]{0,63}$/.test(value)
    : !!EFFORTS[provider]?.includes(value));
}
