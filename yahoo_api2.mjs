// index.mjs
import express from 'express';
import yahooFinance from 'yahoo-finance2';

const app = express();
const port = process.env.PORT || 3000;

import axios from 'axios';

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
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
setInterval(() => {}, 1 << 30);   // 永远有任务，进程不会退出