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
    res.json(result);          // 结构见官方文档
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
  // const options = {
  //   count: 5,
  //   region: 'US',
  //   lang: 'en-US',
  //   validateResult: false // Disable validation to avoid errors
  // };

  // // try {
  // //   const result = await yahooFinance.dailyGainers(options); // Fetching top gainers
  // //   res.json(result); // Return the top gainers
  // // } catch (e) {
  // //   res.status(500).json({ error: e.message });
  // // }

  // try {
  //   const result = await yahooFinance._moduleExec({
  //     moduleName: 'getScreenerGainers',
  //     query: options,
  //     resultField: 'finance.result[0].quotes',
  //     transform: (data) => data,
  //     validateResult: false
  //   });

  //   res.json(result);
  // } catch (e) {
  //   res.status(500).json({ error: e.message });
  // }

  const url = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved';
  const params = {
    count: 5,
    start: 0,
    scrIds: 'day_gainers',
    lang: 'en-US',
    region: 'US'
  };

  try {
    const response = await axios.get(url, { params });
    const quotes = response.data.finance.result[0].quotes;
    res.json(quotes);
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
    const result = await yahooFinance.trendingSymbols('US'); // 也可换成 'GB' 等
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 4. 市场主要指数  GET /api/index                                     */
/* ------------------------------------------------------------------ */
const INDEX_TICKERS = ['^GSPC', '^DJI', '^IXIC', '^RUT', '^TNX']; // 可增删
app.get('/api/index', async (_req, res) => {
  try {
    const data = await yahooFinance.quote(INDEX_TICKERS);
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
    res.json(result);
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