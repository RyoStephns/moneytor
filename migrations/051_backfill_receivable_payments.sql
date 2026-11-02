INSERT INTO receivable_payments (user_id, receivable_id, amount, account_id, paid_at)
SELECT r.user_id, r.id, r.amount, r.settled_account_id, r.settled_at
FROM receivables r
WHERE r.status = 'settled'
  AND NOT EXISTS (SELECT 1 FROM receivable_payments p WHERE p.receivable_id = r.id)
