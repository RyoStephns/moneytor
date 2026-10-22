CREATE TABLE IF NOT EXISTS invite_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code_hash CHAR(64) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_by_user_id BIGINT UNSIGNED NULL,
  used_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invite_codes_hash (code_hash),
  INDEX idx_invite_codes_creator (created_by),
  CONSTRAINT chk_invite_codes_state CHECK (used_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT fk_invite_codes_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_invite_codes_used_by FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
)
