CREATE TABLE IF NOT EXISTS receivable_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  receivable_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(18, 2) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  paid_at DATETIME(3) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_receivable_payments_receivable (receivable_id),
  INDEX idx_receivable_payments_user (user_id),
  INDEX idx_receivable_payments_account (account_id),
  CONSTRAINT chk_receivable_payments_amount CHECK (amount > 0),
  CONSTRAINT fk_receivable_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_receivable_payments_receivable FOREIGN KEY (receivable_id) REFERENCES receivables(id) ON DELETE CASCADE,
  CONSTRAINT fk_receivable_payments_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
)
