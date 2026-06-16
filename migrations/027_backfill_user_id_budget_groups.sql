UPDATE budget_groups bg JOIN pay_periods pp ON pp.id = bg.pay_period_id SET bg.user_id = pp.user_id WHERE bg.user_id IS NULL
