INSERT INTO users (id, email, is_owner, status, display_name)
VALUES (1, 'owner@moneytor.local', 1, 'active', 'Owner')
ON DUPLICATE KEY UPDATE is_owner = 1
