CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type ENUM('income', 'expense') NOT NULL,
  amount DECIMAL(18, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  category VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  occurred_at DATETIME(3) NOT NULL,
  account VARCHAR(120) NULL,
  tags_json JSON NOT NULL,
  source VARCHAR(120) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_transactions_occurred_at (occurred_at),
  INDEX idx_transactions_type_date (type, occurred_at),
  INDEX idx_transactions_category_date (category, occurred_at),
  INDEX idx_transactions_account_date (account, occurred_at),
  INDEX idx_transactions_currency_date (currency, occurred_at)
);
