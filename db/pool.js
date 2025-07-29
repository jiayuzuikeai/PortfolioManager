import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,


  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  // ✅ Add this line to allow running multiple statements
  multipleStatements: true
});

export default pool;