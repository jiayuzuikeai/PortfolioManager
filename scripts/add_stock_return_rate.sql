-- 添加 stock_return_rate 列到 portfolio 表
-- 这个列将计算每只股票的收益率百分比

USE stock;

ALTER TABLE portfolio 
ADD COLUMN stock_return_rate DECIMAL(10,2) 
GENERATED ALWAYS AS (
  CASE 
    WHEN avg_buy_price > 0 THEN 
      ROUND(((current_price - avg_buy_price) / avg_buy_price) * 100, 2)
    ELSE 0 
  END
) STORED;

-- 验证新列是否添加成功
DESCRIBE portfolio;

-- 查看现有数据，确认计算是否正确
SELECT 
  ticker,
  quantity,
  avg_buy_price,
  current_price,
  stock_return,
  stock_return_rate,
  CONCAT(stock_return_rate, '%') as formatted_return_rate
FROM portfolio 
WHERE quantity > 0;
