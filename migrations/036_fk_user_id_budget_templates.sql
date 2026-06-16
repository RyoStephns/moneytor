ALTER TABLE budget_templates ADD CONSTRAINT fk_budget_templates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
