CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  type ENUM('cash', 'bank', 'ewallet', 'other') NOT NULL DEFAULT 'other',
  description VARCHAR(500) NULL,
  opening_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  default_owner BIGINT UNSIGNED GENERATED ALWAYS AS (IF(is_default = 1, user_id, NULL)) VIRTUAL,
  archived_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accounts_user_name (user_id, name),
  UNIQUE KEY uq_accounts_one_default (default_owner),
  CONSTRAINT fk_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
