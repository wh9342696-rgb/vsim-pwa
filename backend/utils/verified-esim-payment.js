export const VERIFIED_ESIM_PAYMENT_CONDITIONS_SQL = `
  pr.status = 'completed'
  AND pr.payment_status = 'PAYMENT_VERIFIED'
  AND COALESCE(pr.payment_method, 'mobile_money') <> 'wallet'
  AND pr.order_status = 'ESIM_READY'
  AND pr.provisioning_status = 'COMPLETED'
  AND pr.package_id IS NOT NULL
  AND pr.verified_amount IS NOT NULL
  AND ABS(pr.verified_amount - pr.amount) <= 0.01
  AND COALESCE(pr.verified_transaction_reference, '') <> ''
  AND pr.provisioned_esim_id = ue.id
  AND pr.user_id = ue.user_id
`;