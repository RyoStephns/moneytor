CREATE TABLE IF NOT EXISTS account_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(18, 2) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_adjustments_account_date (account_id, occurred_at),
  INDEX idx_adjustments_user (user_id),
  CONSTRAINT chk_adjustments_amount CHECK (amount <> 0),
  CONSTRAINT fk_adjustments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_adjustments_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
)
