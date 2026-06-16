ALTER TABLE pay_periods ADD UNIQUE KEY uq_period_user_start (user_id, period_start)
