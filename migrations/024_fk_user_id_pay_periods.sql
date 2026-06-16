ALTER TABLE pay_periods ADD CONSTRAINT fk_pay_periods_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
