CREATE TABLE IF NOT EXISTS transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  from_account_id BIGINT UNSIGNED NOT NULL,
  to_account_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(18, 2) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_transfers_user_date (user_id, occurred_at),
  CONSTRAINT chk_transfers_amount CHECK (amount > 0),
  CONSTRAINT chk_transfers_distinct CHECK (from_account_id <> to_account_id),
  CONSTRAINT fk_transfers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_transfers_from FOREIGN KEY (from_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_transfers_to FOREIGN KEY (to_account_id) REFERENCES accounts(id) ON DELETE CASCADE
)
