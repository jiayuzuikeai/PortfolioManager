-- 创建 portfolio 表
CREATE TABLE IF NOT EXISTS portfolio (
    ticker VARCHAR(10) PRIMARY KEY,
    quantity INT NOT NULL,
    avg_buy_price DECIMAL(10, 2) NOT NULL,
    current_price DECIMAL(10, 2) DEFAULT 0.00,
    stock_return DECIMAL(10, 2) GENERATED ALWAYS AS ((current_price - avg_buy_price) * quantity) STORED,
    stock_return_rate DECIMAL(10, 2) GENERATED ALWAYS AS (
        CASE 
            WHEN avg_buy_price > 0 THEN 
                ROUND(((current_price - avg_buy_price) / avg_buy_price) * 100, 2)
            ELSE 0 
        END
    ) STORED
);

-- 创建 transactions 表
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticker VARCHAR(10) NOT NULL,
    type ENUM('BUY', 'SELL') NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建 cash 表
CREATE TABLE IF NOT EXISTS cash (
    id INT PRIMARY KEY DEFAULT 1,
    balance DECIMAL(15, 2) NOT NULL
);

-- 插入初始现金
INSERT IGNORE INTO cash (id, balance) VALUES (1, 500000.00);

-- 创建每日资产快照表
CREATE TABLE IF NOT EXISTS daily_snapshot (
    id INT AUTO_INCREMENT PRIMARY KEY,
    snapshot_date DATE NOT NULL UNIQUE,
    total_stock_value DECIMAL(15, 2) NOT NULL,
    cash_balance DECIMAL(15, 2) NOT NULL,
    total_value DECIMAL(15, 2) NOT NULL,
    total_return DECIMAL(15, 2) NOT NULL,
    total_return_rate DECIMAL(6, 2) NOT NULL
);
