CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code_hash CHAR(64) NOT NULL PRIMARY KEY,
  family_id CHAR(36) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  code_challenge VARCHAR(255) NOT NULL,
  redirect_uri VARCHAR(2048) NOT NULL,
  scopes VARCHAR(500) NULL,
  resource VARCHAR(2048) NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_codes_expires (expires_at),
  INDEX idx_auth_codes_user (user_id),
  CONSTRAINT fk_auth_codes_client FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  CONSTRAINT fk_auth_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
