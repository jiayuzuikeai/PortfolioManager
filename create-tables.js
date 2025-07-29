// create-tables.js
import fs from 'fs';
import path from 'path';
import pool from './db/pool.js';

async function runSQLScript() {
  const sql = fs.readFileSync(path.join('scripts', 'create_tables.sql'), 'utf8');
  try {
    const connection = await pool.getConnection();
    await connection.query(sql);
    console.log('✅ Tables created successfully.');
    connection.release();
  } catch (err) {
    console.error('❌ Error creating tables:', err);
  } finally {
    process.exit();
  }
}

runSQLScript();
