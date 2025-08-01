// tests/api.test.js
import request from 'supertest';
import { createServer } from 'http';
import app from '../yahoo_api.mjs';

let server;
beforeAll(() => { server = createServer(app).listen(); });
afterAll(() => server.close());
const api = () => request(server);

describe('gainer & portfolio & trade', () => {
  it('GET /api/top/gainer → 200 & array', async () => {
    const res = await api().get('/api/top/gainer');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(10);
  });

  it('GET /api/portfolio 返回数组', async () => {
    const res = await api().get('/api/portfolio');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.portfolio)).toBe(true);
  });

  it('POST /api/portfolio/buy → 数量增加 5', async () => {
    let p = await api().get('/api/portfolio');
    const before = p.body.portfolio.find(s => s.ticker === 'NVDA')?.quantity ?? 0;

    await api().post('/api/portfolio/buy')
              .send({ ticker: 'NVDA', quantity: 5, price: 200 });

    p = await api().get('/api/portfolio');
    const after = p.body.portfolio.find(s => s.ticker === 'NVDA')?.quantity ?? 0;
    expect(after).toBe(before + 5);
  });

  it('POST /api/portfolio/sell → 数量减少 2', async () => {
    // 预置：先买 5 股（保证可卖）
    await api().post('/api/portfolio/buy')
              .send({ ticker: 'NVDA', quantity: 5, price: 200 });

    let p = await api().get('/api/portfolio');
    const before = p.body.portfolio.find(s => s.ticker === 'NVDA')?.quantity ?? 0;

    await api().post('/api/portfolio/sell')
              .send({ ticker: 'NVDA', quantity: 2, price: 250 });

    p = await api().get('/api/portfolio');
    const after = p.body.portfolio.find(s => s.ticker === 'NVDA')?.quantity ?? 0;
    expect(after).toBe(before - 2);
  });
});