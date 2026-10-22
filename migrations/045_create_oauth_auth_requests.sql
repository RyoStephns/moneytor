CREATE TABLE IF NOT EXISTS oauth_auth_requests (
  id CHAR(36) NOT NULL PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL,
  redirect_uri VARCHAR(2048) NOT NULL,
  code_challenge VARCHAR(255) NOT NULL,
  state VARCHAR(2048) NULL,
  scopes VARCHAR(500) NULL,
  resource VARCHAR(2048) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_requests_expires (expires_at),
  CONSTRAINT fk_auth_requests_client FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE
)
