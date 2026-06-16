ALTER TABLE budget_groups ADD CONSTRAINT fk_budget_groups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
