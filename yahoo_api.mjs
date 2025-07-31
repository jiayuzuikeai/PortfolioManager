// index.mjs
import express from 'express';
import yahooFinance from 'yahoo-finance2';
import pool from './db/pool.js';
import axios from 'axios';
import cron from 'node-cron';
import OpenAI from 'openai';
import cors from 'cors';
import http from 'http';
import dotenv from 'dotenv';
dotenv.config();      

const app = express();
const port = process.env.PORT || 3000;

// Middleware for parsing JSON
app.use(express.json());
app.use(cors()); 

const kimi = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL
});

/* ---------- 会话缓存（生产环境用 Redis） ---------- */
const sessions = new Map(); // <sessionId, Array<Message>>


/* ---------- 投资管理助手：多轮聊天（SSE 流式） ---------- */
app.get('/api/chat', async (req, res) => {
  try {
    const { q: userInput, sessionId = 'default' } = req.query;
    if (!userInput) {
      return res.status(400).json({ error: 'Missing query param "q"' });
    }

    /* ---------- 1. 实时拉取持仓信息 ---------- */
    let portfolioText = '';
    try {
      // 本地调用自己的接口，不走网络
      const portfolioRes = await new Promise((resolve, reject) => {
        const httpReq = http.request(
          {
            hostname: 'localhost',
            port,
            path: '/api/portfolio',
            method: 'GET',
          },
          (httpRes) => {
            let body = '';
            httpRes.on('data', (chunk) => (body += chunk));
            httpRes.on('end', () => resolve(JSON.parse(body)));
          }
        );
        httpReq.on('error', reject);
        httpReq.end();
      });

      const { portfolio, total_stock_value, total_return, cashBalance } = portfolioRes;
      const cash = portfolioRes.cashBalance ?? 0;

      // 拼成自然语言
      portfolioText = `
      Portfolio Overview (as of ${new Date().toLocaleString()}):
      - Cash Balance: ${cash.toFixed(2)} CNY
      - Total Stock Value: ${total_stock_value.toFixed(2)} CNY
      - Cumulative P/L: ${total_return.toFixed(2)} CNY
      Holdings:
      ${portfolio
        .map(
          (p) =>
            `  ${p.ticker}: ${p.quantity} shares, avg cost ${parseFloat(
              p.avg_buy_price
            ).toFixed(2)} CNY, current price ${parseFloat(p.current_price).toFixed(
              2
            )} CNY, P/L ${parseFloat(p.stock_return).toFixed(2)} CNY (${(
              parseFloat(p.stock_return_rate) * 100
            ).toFixed(2)}%)`
        )
        .join('\n')}
      `;
      console.log('AI has fetched portfolio info!');
      } catch (e) {
        console.error('Failed to load portfolio', e);
        portfolioText = '(Unable to fetch latest holdings at the moment)';
      }

      /* ---------- 2. Initialize / Retrieve Session ---------- */
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, [
          {
            role: 'system',
            content:
              'You are my line manager. Provide accurate, compliant investment analysis and advice based on the latest real holdings below; decline any illegal or non-compliant content.\n\n',
          },
        ]);
      }

      const history = sessions.get(sessionId);
      history.push({ role: 'system', content: 'Latest holdings: ' + portfolioText });
      history.push({ role: 'user', content: userInput });

    /* ---------- SSE 头 ---------- */
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    /* ---------- 3. 请求 Kimi 流式回答 ---------- */
    const stream = await kimi.chat.completions.create({
      model: 'kimi-k2-0711-preview',
      messages: history,
      stream: true,
    });

    let assistantText = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      assistantText += delta;
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }

    history.push({ role: 'assistant', content: assistantText });
    sessions.set(sessionId, history);

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ error: 'Chat failed' })}\n\n`);
    res.end();
  }
});


/* ------------------------------------------------------------------ */
/* 1. 股票搜索  GET /api/search?q=KEYWORD                              */
/* ------------------------------------------------------------------ */
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing query param "q"' });

    const result = await yahooFinance.search(q);
    const symbols = result.quotes
      .filter(q => q.quoteType === 'EQUITY')
      .map(q => q.symbol);

    if (!symbols.length) return res.json([]);

    /* 3. 批量拉行情 */
    const quotes = await yahooFinance.quote(symbols);

    /* 4. 映射成前端要的格式 */
    const data = quotes.map(item => ({
      symbol: item.symbol,
      name:   item.shortName || item.longName,
      price:  item.regularMarketPrice,
      change: item.regularMarketChange,
      changePercent: item.regularMarketChangePercent,
      volume: item.regularMarketVolume,
      marketCap: item.marketCap
    }));

    res.json(data);          // 结构见官方文档
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 2. Top Gainers / Losers                                              */
/*    GET /api/top/gainer                                             */
// /*    GET /api/top/loser                                              */
// /* ------------------------------------------------------------------ */

app.get('/api/top/gainer', async (_req, res) => {

  const url = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved';
  const params = {
    count: 10,
    start: 0,
    scrIds: 'day_gainers',
    lang: 'en-US',
    region: 'US'
  };

  try {
    const response = await axios.get(url, { params });
    const raw = response.data.finance.result[0].quotes;
    const list = Array.isArray(raw) ? raw : [raw];

    const data = list.map(item => ({
      symbol: item.symbol,
      name:   item.shortName || item.longName,
      price:  item.regularMarketPrice,
      change: item.regularMarketChange,
      changePercent: item.regularMarketChangePercent,
      volume: item.regularMarketVolume,
      marketCap: item.marketCap
    }));

    res.json(data);
  } catch (error) {
    console.error('Yahoo API failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch top gainers' });
  }
});

app.get('/api/top/loser', async (_req, res) => {

  const url = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved';
  const params = {
    count: 10,
    start: 0,
    scrIds: 'day_losers',
    lang: 'en-US',
    region: 'US'
  };

  try {
    const response = await axios.get(url, { params });
    const raw = response.data.finance.result[0].quotes;
    const list = Array.isArray(raw) ? raw : [raw];

    const data = list.map(item => ({
      symbol: item.symbol,
      name:   item.shortName || item.longName,
      price:  item.regularMarketPrice,
      change: item.regularMarketChange,
      changePercent: item.regularMarketChangePercent,
      volume: item.regularMarketVolume,
      marketCap: item.marketCap
    }));

    res.json(data);
  } catch (error) {
    console.error('Yahoo API failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch top gainers' });
  }
});

/* ------------------------------------------------------------------ */
/* 3. 热门交易股票  GET /api/top/trending                              */
/* ------------------------------------------------------------------ */
app.get('/api/top/trending', async (_req, res) => {
  try {
    /* 1️⃣ 拉取热门榜 symbol */
    // console.log('Trending symbols0');  // 调试输出
    const { data: trend } = await axios.get(
      'https://query1.finance.yahoo.com/v1/finance/trending/US',
      { params: { count: 10, lang: 'en-US', region: 'US' } }
    );

    const symbols = (trend?.finance?.result?.[0]?.quotes ?? [])
      .map(q => q.symbol)
      // .join(',');
    console.log('Trending symbols:', symbols);  // 调试输出

    if (!symbols) {
      return res.status(404).json({ error: 'No trending symbols found' });
    }


    const raw = await yahooFinance.quote(symbols);

    // yahooFinance.quote 可能返回数组或对象，统一成数组
    const list = Array.isArray(raw) ? raw : [raw];

    const data = list.map(item => ({
      symbol: item.symbol,
      name:   item.shortName || item.longName,
      price:  item.regularMarketPrice,
      change: item.regularMarketChange,
      changePercent: item.regularMarketChangePercent,
      volume: item.regularMarketVolume,
      marketCap: item.marketCap
    }));

    res.json(data);
  } catch (err) {
    console.error('Trending API failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch trending stocks' });
  }
});

/* ------------------------------------------------------------------ */
/* 4. 市场主要指数  GET /api/index                                     */
/* ------------------------------------------------------------------ */
const INDEX_TICKERS = ['^GSPC', '^DJI', '^IXIC', '^RUT', '^TNX'];

app.get('/api/index', async (_req, res) => {
  try {
    const raw = await yahooFinance.quote(INDEX_TICKERS);

    // yahooFinance.quote 可能返回数组或对象，统一成数组
    const list = Array.isArray(raw) ? raw : [raw];

    const data = list.map(item => ({
      symbol: item.symbol,
      name:   item.shortName || item.longName,
      price:  item.regularMarketPrice,
      change: item.regularMarketChange,
      changePercent: item.regularMarketChangePercent
    }));

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 5. 股票信息查询  GET /api/quote/:ticker                             */
/* ------------------------------------------------------------------ */
app.get('/api/quote/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const result = await yahooFinance.quote(ticker);
    const data = {
      symbol: result.symbol,
      name: result.shortName || result.longName,
      price: result.regularMarketPrice,
      change: result.regularMarketChange,
      changePercent: result.regularMarketChangePercent,
      volume: result.regularMarketVolume,
      marketCap: result.marketCap
    };
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 6. 股票历史价格  GET /api/history/:ticker                           */
/*    可选 query: period1, period2, interval (1d,1wk,1mo...)          */
/* ------------------------------------------------------------------ */
app.get('/api/history/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const {
      period1,                             // 若缺省，默认 1 年前
      period2 = new Date(),                // 默认今天
      interval = '1d'
    } = req.query;

    // 计算默认起止时间
    const start = period1
      ? new Date(period1)
      : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 年前

    const result = await yahooFinance.chart(ticker, {
      period1: start,
      period2: new Date(period2),
      interval
    });

    const history = result.quotes
      .filter(q => q.open != null)
      .map(q => ({
        date:    q.date,
        open:    q.open,
        high:    q.high,
        low:     q.low,
        close:   q.close,
        volume:  q.volume,
        adjClose: q.adjclose
      }));

    res.json(history);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
/* ------------------------------------------------------------------ */
/* 7. 当前持仓查询  GET /api/portfolio                                 */
/* ------------------------------------------------------------------ */
app.get('/api/portfolio', async (_req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // 获取所有持仓
    const [portfolioRows] = await connection.query(`
      SELECT ticker, quantity, avg_buy_price, current_price, stock_return, stock_return_rate
      FROM portfolio 
      WHERE quantity > 0
    `);
    
    // 获取现金余额
    const [cashRows] = await connection.query('SELECT balance FROM cash WHERE id = 1');
    const cashBalance = cashRows[0]?.balance || 0;
    
    // 计算总股票价值和总收益
    let totalStockValue = 0;
    let totalReturn = 0;
    
    for (const stock of portfolioRows) {
      totalStockValue += parseFloat(stock.current_price) * stock.quantity;
      totalReturn += parseFloat(stock.stock_return);
    }
    
    connection.release();
    
    res.json({
      portfolio: portfolioRows,
      total_stock_value: totalStockValue,
      total_return: totalReturn
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 8. 买入操作  POST /api/portfolio/buy                               */
/*    Body: { ticker, quantity, price }                              */
/* ------------------------------------------------------------------ */
app.post('/api/portfolio/buy', async (req, res) => {
  try {
    const { ticker, quantity, price } = req.body;
    
    if (!ticker || !quantity || !price) {
      return res.status(400).json({ 
        error: 'Missing required fields: ticker, quantity, price' 
      });
    }
    
    if (quantity <= 0 || price <= 0) {
      return res.status(400).json({ 
        error: 'Quantity and price must be positive numbers' 
      });
    }
    
    const totalCost = quantity * price;
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // 检查现金是否足够
      const [cashRows] = await connection.query('SELECT balance FROM cash WHERE id = 1');
      const currentCash = parseFloat(cashRows[0]?.balance || 0);
      
      if (currentCash < totalCost) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ 
          error: 'Insufficient cash balance',
          required: totalCost,
          available: currentCash
        });
      }
      
      // 检查是否已有该股票持仓
      const [existingRows] = await connection.query(
        'SELECT quantity, avg_buy_price FROM portfolio WHERE ticker = ?',
        [ticker]
      );
      
      if (existingRows.length > 0) {
        // 更新现有持仓 - 计算新的平均买入价
        const existingQuantity = existingRows[0].quantity;
        const existingAvgPrice = parseFloat(existingRows[0].avg_buy_price);
        const newQuantity = existingQuantity + quantity;
        const newAvgPrice = ((existingQuantity * existingAvgPrice) + totalCost) / newQuantity;
        
        await connection.query(
          'UPDATE portfolio SET quantity = ?, avg_buy_price = ?, current_price = ? WHERE ticker = ?',
          [newQuantity, newAvgPrice, price, ticker]
        );
      } else {
        // 创建新持仓
        await connection.query(
          'INSERT INTO portfolio (ticker, quantity, avg_buy_price, current_price) VALUES (?, ?, ?, ?)',
          [ticker, quantity, price, price]
        );
      }
      
      // 记录交易
      await connection.query(
        'INSERT INTO transactions (ticker, type, quantity, price) VALUES (?, ?, ?, ?)',
        [ticker, 'BUY', quantity, price]
      );
      
      // 更新现金余额
      await connection.query(
        'UPDATE cash SET balance = balance - ? WHERE id = 1',
        [totalCost]
      );
      
      await connection.commit();
      connection.release();
      
      res.json({
        message: 'Buy order executed successfully',
        ticker,
        quantity,
        price,
        total_cost: totalCost,
        remaining_cash: currentCash - totalCost
      });
      
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 9. 卖出操作  POST /api/portfolio/sell                              */
/*    Body: { ticker, quantity, price }                              */
/* ------------------------------------------------------------------ */
app.post('/api/portfolio/sell', async (req, res) => {
  try {
    const { ticker, quantity, price } = req.body;
    
    if (!ticker || !quantity || !price) {
      return res.status(400).json({ 
        error: 'Missing required fields: ticker, quantity, price' 
      });
    }
    
    if (quantity <= 0 || price <= 0) {
      return res.status(400).json({ 
        error: 'Quantity and price must be positive numbers' 
      });
    }
    
    const totalRevenue = quantity * price;
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // 检查是否有足够的股票可卖
      const [portfolioRows] = await connection.query(
        'SELECT quantity, avg_buy_price FROM portfolio WHERE ticker = ?',
        [ticker]
      );
      
      if (portfolioRows.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ 
          error: 'No position found for this ticker' 
        });
      }
      
      const currentQuantity = portfolioRows[0].quantity;
      const avgBuyPrice = parseFloat(portfolioRows[0].avg_buy_price);
      
      if (currentQuantity < quantity) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ 
          error: 'Insufficient shares to sell',
          requested: quantity,
          available: currentQuantity
        });
      }
      
      const newQuantity = currentQuantity - quantity;
      
      if (newQuantity === 0) {
        // 完全卖出，删除持仓记录
        await connection.query('DELETE FROM portfolio WHERE ticker = ?', [ticker]);
      } else {
        // 部分卖出，更新数量和当前价格
        await connection.query(
          'UPDATE portfolio SET quantity = ?, current_price = ? WHERE ticker = ?',
          [newQuantity, price, ticker]
        );
      }
      
      // 记录交易
      await connection.query(
        'INSERT INTO transactions (ticker, type, quantity, price) VALUES (?, ?, ?, ?)',
        [ticker, 'SELL', quantity, price]
      );
      
      // 更新现金余额
      await connection.query(
        'UPDATE cash SET balance = balance + ? WHERE id = 1',
        [totalRevenue]
      );
      
      // 计算这次交易的盈亏
      const profit = (price - avgBuyPrice) * quantity;
      
      await connection.commit();
      connection.release();
      
      res.json({
        message: 'Sell order executed successfully',
        ticker,
        quantity,
        price,
        total_revenue: totalRevenue,
        profit_loss: profit,
        remaining_shares: newQuantity
      });
      
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 10. 查看现金余额  GET /api/cash                                    */
/* ------------------------------------------------------------------ */
app.get('/api/cash', async (_req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [cashRows] = await connection.query('SELECT balance FROM cash WHERE id = 1');
    const cashBalance = parseFloat(cashRows[0]?.balance || 0);
    
    connection.release();
    
    res.json({
      cash_balance: cashBalance,
      currency: 'USD'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 11. 获取每日资产快照  GET /api/daily_snapshot                      */
/* ------------------------------------------------------------------ */
app.get('/api/daily_snapshot', async (req, res) => {
  try {
    const { limit = 30, start_date, end_date } = req.query;
    const connection = await pool.getConnection();
    
    let query = `
      SELECT 
        snapshot_date,
        total_stock_value,
        cash_balance,
        total_value,
        total_return,
        total_return_rate
      FROM daily_snapshot
    `;
    
    const params = [];
    const conditions = [];
    
    // 添加日期过滤条件
    if (start_date) {
      conditions.push('snapshot_date >= ?');
      params.push(start_date);
    }
    
    if (end_date) {
      conditions.push('snapshot_date <= ?');
      params.push(end_date);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ` ORDER BY snapshot_date DESC LIMIT ?`;
    params.push(parseInt(limit));
    
    const [rows] = await connection.query(query, params);
    connection.release();
    
    res.json({
      snapshots: rows,
      count: rows.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 12. 触发资产快照更新  POST /api/daily_snapshot                     */
/* ------------------------------------------------------------------ */
app.post('/api/daily_snapshot', async (req, res) => {
  try {
    const { snapshot_date } = req.body;
    const targetDate = snapshot_date || new Date().toISOString().split('T')[0];
    
    const result = await createDailySnapshot(targetDate);
    
    if (result.success) {
      res.json({
        message: 'Daily snapshot created/updated successfully',
        snapshot_date: result.snapshot_date,
        data: result.data
      });
    } else {
      res.status(500).json({ error: result.error });
    }
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 13. 更新投资组合股票价格  POST /api/portfolio/update-prices         */
/* ------------------------------------------------------------------ */
app.post('/api/portfolio/update-prices', async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] 开始更新投资组合股票价格`);
    
    const result = await updatePortfolioPrices();
    
    if (result.success) {
      res.json({
        message: 'Portfolio prices updated successfully',
        updated_count: result.updatedCount,
        total_count: result.totalCount,
        updated_stocks: result.updatedStocks,
        failed_stocks: result.failedStocks
      });
    } else {
      res.status(500).json({ error: result.error });
    }
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 自动快照函数 - 内部使用                                            */
/* ------------------------------------------------------------------ */
async function updatePortfolioPrices() {
  try {
    console.log(`[${new Date().toISOString()}] 开始获取投资组合股票列表`);
    
    const connection = await pool.getConnection();
    
    try {
      // 获取所有持仓股票
      const [portfolioRows] = await connection.query(`
        SELECT ticker FROM portfolio WHERE quantity > 0
      `);
      
      const totalCount = portfolioRows.length;
      let updatedCount = 0;
      const updatedStocks = [];
      const failedStocks = [];
      
      console.log(`[${new Date().toISOString()}] 找到 ${totalCount} 只股票需要更新价格`);
      
      // 循环更新每只股票的价格
      for (const stock of portfolioRows) {
        const ticker = stock.ticker;
        
        try {
          console.log(`[${new Date().toISOString()}] 正在获取 ${ticker} 的最新价格...`);
          
          // 调用 Yahoo Finance API 获取股票价格
          const quoteResult = await yahooFinance.quote(ticker);
          const currentPrice = quoteResult.regularMarketPrice;
          
          if (currentPrice && currentPrice > 0) {
            // 更新数据库中的当前价格
            await connection.query(
              'UPDATE portfolio SET current_price = ? WHERE ticker = ?',
              [currentPrice, ticker]
            );
            
            updatedCount++;
            updatedStocks.push({
              ticker,
              price: currentPrice,
              currency: quoteResult.currency || 'USD'
            });
            
            console.log(`[${new Date().toISOString()}] ✅ ${ticker} 价格更新成功: $${currentPrice}`);
          } else {
            failedStocks.push({
              ticker,
              error: 'Invalid price data received'
            });
            console.log(`[${new Date().toISOString()}] ❌ ${ticker} 价格数据无效`);
          }
          
          // 添加短暂延迟避免API限制
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          failedStocks.push({
            ticker,
            error: error.message
          });
          console.error(`[${new Date().toISOString()}] ❌ ${ticker} 价格获取失败:`, error.message);
        }
      }
      
      connection.release();
      
      console.log(`[${new Date().toISOString()}] 价格更新完成: ${updatedCount}/${totalCount} 成功`);
      
      return {
        success: true,
        totalCount,
        updatedCount,
        updatedStocks,
        failedStocks
      };
      
    } catch (error) {
      connection.release();
      throw error;
    }
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] 投资组合价格更新失败:`, error.message);
    return { success: false, error: error.message };
  }
}

async function createDailySnapshot(targetDate = null) {
  try {
    const snapshotDate = targetDate || new Date().toISOString().split('T')[0];
    console.log(`[${new Date().toISOString()}] 开始创建每日资产快照: ${snapshotDate}`);
    
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // 1. 计算当前现金余额
      const [cashRows] = await connection.query('SELECT balance FROM cash WHERE id = 1');
      const cashBalance = parseFloat(cashRows[0]?.balance || 0);
      
      // 2. 计算当前股票总价值和总收益
      const [portfolioRows] = await connection.query(`
        SELECT 
          SUM(current_price * quantity) as total_stock_value,
          SUM(stock_return) as total_return
        FROM portfolio 
        WHERE quantity > 0
      `);
      
      const totalStockValue = parseFloat(portfolioRows[0]?.total_stock_value || 0);
      const totalReturn = parseFloat(portfolioRows[0]?.total_return || 0);
      const totalValue = cashBalance + totalStockValue;
      
      // 3. 计算总收益率 (假设初始资金为500000)
      const initialInvestment = 500000;
      const totalReturnRate = ((totalValue - initialInvestment) / initialInvestment) * 100;
      
      // 4. 检查是否已存在该日期的快照
      const [existingRows] = await connection.query(
        'SELECT id FROM daily_snapshot WHERE snapshot_date = ?',
        [snapshotDate]
      );
      
      if (existingRows.length > 0) {
        // 更新现有快照
        await connection.query(`
          UPDATE daily_snapshot 
          SET 
            total_stock_value = ?,
            cash_balance = ?,
            total_value = ?,
            total_return = ?,
            total_return_rate = ?
          WHERE snapshot_date = ?
        `, [totalStockValue, cashBalance, totalValue, totalReturn, totalReturnRate, snapshotDate]);
        console.log(`[${new Date().toISOString()}] 快照更新成功: ${snapshotDate}`);
      } else {
        // 创建新快照
        await connection.query(`
          INSERT INTO daily_snapshot 
          (snapshot_date, total_stock_value, cash_balance, total_value, total_return, total_return_rate)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [snapshotDate, totalStockValue, cashBalance, totalValue, totalReturn, totalReturnRate]);
        console.log(`[${new Date().toISOString()}] 快照创建成功: ${snapshotDate}`);
      }
      
      await connection.commit();
      connection.release();
      
      return {
        success: true,
        snapshot_date: snapshotDate,
        data: {
          total_stock_value: totalStockValue,
          cash_balance: cashBalance,
          total_value: totalValue,
          total_return: totalReturn,
          total_return_rate: parseFloat(totalReturnRate.toFixed(2))
        }
      };
      
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] 快照创建失败:`, error.message);
    return { success: false, error: error.message };
  }
}

/* ------------------------------------------------------------------ */
/* 定时任务设置                                                       */
/* ------------------------------------------------------------------ */

// 美股市场时间 (ET): 9:30 AM - 4:00 PM
// 转换为UTC时间: 
// - 夏令时 (3月第二个周日 - 11月第一个周日): 13:30 - 20:00 UTC
// - 冬令时: 14:30 - 21:00 UTC
// 我们设置在收盘后1小时执行快照，即:
// - 夏令时: 21:00 UTC (北京时间凌晨5点)
// - 冬令时: 22:00 UTC (北京时间早上6点)

// 测试任务: 每分钟执行一次 (用于测试)
// cron.schedule('* * * * *', async () => {
//   console.log(`[${new Date().toISOString()}] 🧪 测试任务触发 - 每分钟测试`);
//   console.log(`当前北京时间: ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`);
//   console.log(`当前系统时间: ${new Date().toString()}`);
//   const result = await createDailySnapshot();
//   if (result.success) {
//     console.log(`[${new Date().toISOString()}] ✅ 测试快照成功完成`);
//   } else {
//     console.log(`[${new Date().toISOString()}] ❌ 测试快照失败: ${result.error}`);
//   }
// });

// 测试任务: 每分钟更新投资组合股票价格 (用于测试)
// cron.schedule('* * * * *', async () => {
//   console.log(`[${new Date().toISOString()}] 📈 测试任务触发 - 每分钟更新股票价格`);
//   console.log(`当前北京时间: ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`);
//   console.log(`当前系统时间: ${new Date().toString()}`);
//   const result = await updatePortfolioPrices();
//   if (result.success) {
//     console.log(`[${new Date().toISOString()}] ✅ 测试价格更新成功: ${result.updatedCount}/${result.totalCount}`);
//   } else {
//     console.log(`[${new Date().toISOString()}] ❌ 测试价格更新失败: ${result.error}`);
//   }
// });

// 定时任务: 每天北京时间早上9点40分执行
cron.schedule('40 9 * * *', async () => {
  console.log(`[${new Date().toISOString()}] 🕘 每日定时任务触发 - 北京时间9:40`);
  console.log(`当前北京时间: ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`);
  console.log(`当前系统时间: ${new Date().toString()}`);
  console.log(`当前UTC时间: ${new Date().toISOString()}`);
  const result = await createDailySnapshot();
  if (result.success) {
    console.log(`[${new Date().toISOString()}] ✅ 每日快照成功完成`);
  } else {
    console.log(`[${new Date().toISOString()}] ❌ 每日快照失败: ${result.error}`);
  }
}, {
  timezone: "Asia/Shanghai"
});

// 定时任务: 每两小时更新投资组合股票价格
cron.schedule('0 */2 * * *', async () => {
  console.log(`[${new Date().toISOString()}] 📈 每两小时价格更新任务触发`);
  console.log(`当前北京时间: ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`);
  const result = await updatePortfolioPrices();
  if (result.success) {
    console.log(`[${new Date().toISOString()}] ✅ 价格更新成功: ${result.updatedCount}/${result.totalCount}`);
  } else {
    console.log(`[${new Date().toISOString()}] ❌ 价格更新失败: ${result.error}`);
  }
});

// 方案1: 使用夏令时时间 (适用于大部分时间)
// 每天UTC时间21:00执行 (北京时间凌晨5点)
// cron.schedule('0 21 * * 1-5', async () => {
//   console.log(`[${new Date().toISOString()}] 定时任务触发 - 美股交易日快照`);
//   await createDailySnapshot();
// }, {
//   timezone: "UTC"
// });

// 方案2: 也可以使用美国东部时间
// 每天东部时间17:00执行 (收盘后1小时)
// cron.schedule('0 17 * * 1-5', async () => {
//   console.log(`[${new Date().toISOString()}] 定时任务触发 - 美股收盘后快照`);
//   await createDailySnapshot();
// }, {
//   timezone: "America/New_York"
// });

// 启动时输出定时任务信息
console.log('定时任务已设置:');
// console.log('� 测试任务: 每分钟更新股票价格 (调试用)');
console.log('�🕘 每日定时任务: 北京时间9:40执行 (Asia/Shanghai时区)');
console.log('📈 价格更新任务: 每两小时执行一次 (0 */2 * * *)');
console.log('- 美股交易日 UTC 21:00 (北京时间凌晨5点) - 已注释');
console.log('- 美股交易日 ET 17:00 (美东时间下午5点) - 已注释');
console.log(`当前北京时间: ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`);
console.log(`当前UTC时间: ${new Date().toISOString()}`);
console.log(`当前系统时间: ${new Date().toString()}`);

/* ------------------------------------------------------------------ */
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));