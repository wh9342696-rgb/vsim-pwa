export function selectWithdrawalFeeRule(priority, conditions) {
  return priority.find(rule => Boolean(conditions[rule])) || 'normal';
}

export function normalizeWithdrawalSettlementDays(value) {
  const configuredDays = String(value ?? '')
    .split(',')
    .map(day => day.trim())
    .filter(Boolean)
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
  return [...new Set([5, ...configuredDays])];
}