CREATE TABLE IF NOT EXISTS receivables (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  borrower VARCHAR(120) NOT NULL,
  amount DECIMAL(18, 2) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  notes TEXT NULL,
  status ENUM('open', 'settled') NOT NULL DEFAULT 'open',
  settled_at DATETIME(3) NULL,
  settled_account_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_receivables_user_status (user_id, status),
  INDEX idx_receivables_account (account_id),
  INDEX idx_receivables_settled_account (settled_account_id),
  CONSTRAINT chk_receivables_amount CHECK (amount > 0),
  CONSTRAINT chk_receivables_settled CHECK (
    (status = 'open' AND settled_at IS NULL AND settled_account_id IS NULL)
    OR (status = 'settled' AND settled_at IS NOT NULL AND settled_account_id IS NOT NULL)
  ),
  CONSTRAINT fk_receivables_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_receivables_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_receivables_settled_account FOREIGN KEY (settled_account_id) REFERENCES accounts(id) ON DELETE CASCADE
)
