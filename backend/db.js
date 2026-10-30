const mysql = require('mysql2');

let db;
try {
    db = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'dividendDB',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    db.on('connection', () => {
        console.log("MySQL connection established in pool");
    });

    db.on('error', (err) => {
        console.warn("MySQL pool error (non-fatal):", err.message);
    });
} catch (err) {
    console.warn("Failed to initialize MySQL pool:", err.message);
    db = {
        query: (sql, params, cb) => {
            const callback = typeof params === 'function' ? params : cb;
            if (callback) callback(new Error("Database not connected"));
        }
    };
}

module.exports = db;

