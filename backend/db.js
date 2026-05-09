const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'tiktok_affiliate.db');
const db = new Database(dbPath, { verbose: console.log });

// Initialize database schema
const initDB = () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS creators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            creator_id TEXT,
            name TEXT,
            gmv REAL DEFAULT 0,
            category TEXT,
            category_id TEXT,
            followers INTEGER DEFAULT 0,
            engagement_rate REAL DEFAULT 0,
            contact_info TEXT,
            avatar_url TEXT,
            region TEXT,
            status TEXT DEFAULT 'Not Contacted',
            last_contacted DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            creator_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            status TEXT DEFAULT 'pending', -- pending, sent, failed
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (creator_id) REFERENCES creators(id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1), -- Only allow one row for global settings
            app_key TEXT,
            app_secret TEXT,
            shop_id TEXT,
            shop_cipher TEXT,
            access_token TEXT,
            refresh_token TEXT,
            access_token_expire_in INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            has_children INTEGER DEFAULT 0
        );
        
        -- Insert a default row if it doesn't exist
        INSERT OR IGNORE INTO settings (id) VALUES (1);
    `);

    // Migrasi: Tambah kolom baru ke tabel creators jika belum ada
    const tableInfo = db.prepare('PRAGMA table_info(creators)').all();
    const existingColumns = tableInfo.map(col => col.name);

    const columnsToAdd = [
        { name: 'gmv_range', type: 'TEXT' },
        { name: 'ec_video_count', type: 'INTEGER DEFAULT 0' },
        { name: 'avg_video_views', type: 'INTEGER DEFAULT 0' },
        { name: 'avg_live_uv', type: 'INTEGER DEFAULT 0' },
        { name: 'pps', type: 'REAL' },
        { name: 'rating', type: 'REAL' }
    ];

    let columnsAdded = 0;
    for (const col of columnsToAdd) {
        if (!existingColumns.includes(col.name)) {
            try {
                db.exec(`ALTER TABLE creators ADD COLUMN ${col.name} ${col.type}`);
                columnsAdded++;
            } catch (err) {
                console.error(`Gagal menambahkan kolom ${col.name}:`, err.message);
            }
        }
    }

    if (columnsAdded > 0) {
        console.log(`Berhasil menambahkan ${columnsAdded} kolom baru ke tabel creators.`);
    }

    console.log('Database initialized successfully.');
    // Migration: Add columns if they don't exist
    try {
        db.exec("ALTER TABLE settings ADD COLUMN shop_id TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE settings ADD COLUMN shop_cipher TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE creators ADD COLUMN creator_id TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE creators ADD COLUMN gmv REAL DEFAULT 0;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE creators ADD COLUMN followers INTEGER DEFAULT 0;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE creators ADD COLUMN engagement_rate REAL DEFAULT 0;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE creators ADD COLUMN avatar_url TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE creators ADD COLUMN region TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE creators ADD COLUMN category_id TEXT;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE creators ADD COLUMN status TEXT DEFAULT 'Not Contacted';");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE creators ADD COLUMN last_contacted DATETIME;");
    } catch (e) {}
};

initDB();

module.exports = db;
