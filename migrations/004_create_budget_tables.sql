CREATE TABLE IF NOT EXISTS pay_periods (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    period_start  DATE NOT NULL,
    period_end    DATE,
    salary_amount DECIMAL(15,2) NOT NULL,
    salary_txn_id INT,
    status        ENUM('estimated','active','closed') DEFAULT 'active',
    notes         TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_period_start (period_start)
);

CREATE TABLE IF NOT EXISTS budget_groups (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    pay_period_id INT NOT NULL,
    name          VARCHAR(120) NOT NULL,
    amount        DECIMAL(15,2) NOT NULL,
    budget_type   ENUM('spending','saving') DEFAULT 'spending',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pay_period_id) REFERENCES pay_periods(id) ON DELETE CASCADE,
    UNIQUE KEY uq_period_group (pay_period_id, name)
);

CREATE TABLE IF NOT EXISTS budget_group_categories (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    budget_group_id INT NOT NULL,
    category        VARCHAR(120) NOT NULL,
    FOREIGN KEY (budget_group_id) REFERENCES budget_groups(id) ON DELETE CASCADE,
    UNIQUE KEY uq_group_category (budget_group_id, category)
);

CREATE TABLE IF NOT EXISTS budget_templates (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(120) NOT NULL,
    groups     JSON NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_template_name (name)
);

CREATE INDEX idx_pay_periods_status ON pay_periods(status);
CREATE INDEX idx_budget_groups_period ON budget_groups(pay_period_id);
CREATE INDEX idx_budget_group_categories_group ON budget_group_categories(budget_group_id);
