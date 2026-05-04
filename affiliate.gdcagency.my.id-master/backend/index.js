const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const axios = require('axios');
const crypto = require('crypto');
const db = require('./db');

// TikTok API Helper
const generateSignature = (apiPath, queryParams, body, appSecret) => {
    const keys = Object.keys(queryParams)
        .filter(key => key !== 'sign' && key !== 'access_token')
        .sort();

    let paramString = '';
    for (const key of keys) {
        paramString += `${key}${queryParams[key]}`;
    }

    let signString = `${apiPath}${paramString}`;

    if (body && Object.keys(body).length > 0) {
        signString += JSON.stringify(body);
    }

    const wrappedString = `${appSecret}${signString}${appSecret}`;

    return crypto
        .createHmac('sha256', appSecret)
        .update(wrappedString)
        .digest('hex');
};

const refreshTikTokToken = async () => {
    const settings = db.prepare('SELECT app_key, app_secret, refresh_token FROM settings WHERE id = 1').get();
    
    if (!settings || !settings.refresh_token) {
        throw new Error('No refresh token available. Please connect your TikTok App again.');
    }

    try {
        const response = await axios.get('https://auth.tiktok-shops.com/api/v2/token/refresh', {
            params: {
                app_key: settings.app_key,
                app_secret: settings.app_secret,
                refresh_token: settings.refresh_token,
                grant_type: 'refresh_token'
            }
        });

        const data = response.data;
        if (data.code === 0 && data.data) {
            const { access_token, refresh_token, access_token_expire_in } = data.data;
            
            db.prepare(`
                UPDATE settings 
                SET access_token = :access_token, 
                    refresh_token = :refresh_token, 
                    access_token_expire_in = :expires_in, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            `).run({
                access_token: access_token || null,
                refresh_token: refresh_token || null,
                expires_in: access_token_expire_in || 0
            });
            
            return access_token;
        } else {
            throw new Error(data.message || 'Failed to refresh TikTok token');
        }
    } catch (err) {
        console.error('Token Refresh Error:', err.response?.data || err.message);
        throw err;
    }
};

const makeTikTokApiCall = async (fullPath, method = 'POST', payload = {}) => {
    let settings = db.prepare('SELECT app_key, app_secret, shop_id, shop_cipher, access_token, updated_at, access_token_expire_in FROM settings WHERE id = 1').get();
    
    if (!settings || !settings.app_key || !settings.access_token) {
        throw new Error('TikTok App is not connected. Please go to settings and connect.');
    }

    // Check if token is expired (with 5 min buffer)
    const updatedAt = settings.updated_at ? new Date(settings.updated_at).getTime() / 1000 : 0;
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = settings.access_token_expire_in || 0;

    if (now > (updatedAt + expiresIn - 300)) {
        console.log('Access token expired. Refreshing...');
        try {
            const newAccessToken = await refreshTikTokToken();
            settings.access_token = newAccessToken;
        } catch (e) {
            console.error('Failed to refresh token automatically:', e.message);
        }
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const [apiPath, queryString] = fullPath.split('?');
    
    // Base query params
    const queryParams = {
        app_key: settings.app_key,
        timestamp: timestamp
    };

    // Include identifiers if available
    if (settings.shop_id) {
        queryParams.shop_id = settings.shop_id;
    }
    if (settings.shop_cipher) {
        queryParams.shop_cipher = settings.shop_cipher;
    }

    // Parse existing query params from fullPath
    if (queryString) {
        queryString.split('&').forEach(pair => {
            const [key, value] = pair.split('=');
            if (key) queryParams[key] = value || '';
        });
    }

    // Ensure body is stringified consistently for signature and request (compact JSON)
    const bodyString = payload && Object.keys(payload).length > 0 ? JSON.stringify(payload) : '';
    const signature = generateSignature(apiPath, queryParams, payload, settings.app_secret);
    
    const baseUrl = 'https://open-api.tiktokglobalshop.com';
    
    // Construct final URL with all sorted params
    const sortedKeys = Object.keys(queryParams).sort();
    let finalQueryString = sortedKeys.map(k => `${k}=${encodeURIComponent(queryParams[k])}`).join('&');
    const url = `${baseUrl}${apiPath}?${finalQueryString}&sign=${signature}`;

    const headers = {
        'x-tts-access-token': settings.access_token,
        'Content-Type': 'application/json'
    };

    try {
        console.log(`TikTok API Request: ${method} ${url}`, bodyString ? bodyString.substring(0, 500) : '');
        const response = await axios({
            method: method,
            url: url,
            headers: headers,
            data: bodyString || undefined
        });
        console.log(`TikTok API Response [${response.status}]:`, JSON.stringify(response.data).substring(0, 500));
        return response.data;
    } catch (err) {
        if (err.response?.status === 401) {
            console.log('API returned 401. Retrying with refreshed token...');
            try {
                const newAccessToken = await refreshTikTokToken();
                const newHeaders = { 
                    'x-tts-access-token': newAccessToken,
                    'Content-Type': 'application/json'
                };
                
                const retryResponse = await axios({
                    method: method,
                    url: url,
                    headers: newHeaders,
                    data: bodyString || undefined
                });
                return retryResponse.data;
            } catch (retryErr) {
                console.error('Retry after 401 failed:', retryErr.message);
            }
        }
        console.error(`TikTok API Error (${fullPath}):`, err.stack || err.message);
        throw err;
    }
};

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// Get all creators (with filters & search)
app.get('/api/creators', (req, res) => {
    const { search, category, minGmv } = req.query;

    let query = 'SELECT * FROM creators WHERE 1=1';
    let params = [];

    if (search) {
        query += ' AND (username LIKE ? OR name LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }

    if (category) {
        query += ' AND category = ?';
        params.push(category);
    }

    if (minGmv) {
        query += ' AND gmv >= ?';
        params.push(minGmv);
    }

    query += ' ORDER BY created_at DESC';

    try {
        const stmt = db.prepare(query);
        const creators = stmt.all(params);
        res.json({ success: true, data: creators });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get TikTok Categories (with DB caching)
app.get('/api/categories', async (req, res) => {
    try {
        // Try to get from DB first
        const cachedCategories = db.prepare('SELECT * FROM categories').all();
        
        if (cachedCategories.length === 0) {
            console.log('Fetching categories from TikTok...');
            const tiktokResponse = await makeTikTokApiCall('/product/202309/categories?channel=1', 'GET');
            
            if (tiktokResponse.code === 0 && (tiktokResponse.data?.categories || tiktokResponse.data?.category_list)) {
                const categories = tiktokResponse.data.categories || tiktokResponse.data.category_list;
                
                const insertStmt = db.prepare(`
                    INSERT OR REPLACE INTO categories (id, name, parent_id, has_children)
                    VALUES (?, ?, ?, ?)
                `);
                
                const syncTransaction = db.transaction((cats) => {
                    for (const cat of cats) {
                        insertStmt.run(
                            cat.id, 
                            cat.local_name || cat.name, 
                            cat.parent_id || '0', 
                            cat.is_leaf ? 0 : 1
                        );
                    }
                });
                
                syncTransaction(categories);
                return res.json({ success: true, data: categories });
            }
        }
        
        res.json({ success: true, data: cachedCategories });
    } catch (err) {
        console.error('Category Sync Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Add creator manually
app.post('/api/creators', (req, res) => {
    const { username, name, category, gmv, followers } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, error: 'Username is required' });
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO creators (username, name, category, gmv, followers)
            VALUES (?, ?, ?, ?, ?)
        `);
        const info = stmt.run(username, name || '', category || '', gmv || 0, followers || 0);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Batch add creators
app.post('/api/creators/batch', (req, res) => {
    const { creators } = req.body;
    if (!creators || !Array.isArray(creators)) {
        return res.status(400).json({ success: false, error: 'Invalid payload' });
    }

    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO creators (
                username, creator_id, name, category, gmv, gmv_range, 
                followers, avatar_url, region
            ) VALUES (
                ?, ?, ?, ?, ?, ?, 
                ?, ?, ?
            )
        `);

        const insertMany = db.transaction((creators) => {
            let count = 0;
            for (const c of creators) {
                if (!c.username) continue;
                stmt.run(
                    c.username,
                    c.creator_id || null,
                    c.name || c.username,
                    c.category || '',
                    c.gmv || 0,
                    c.gmv_range || null,
                    c.followers || 0,
                    c.avatar_url || null,
                    c.region || null
                );
                count++;
            }
            return count;
        });

        const insertedCount = insertMany(creators);
        res.json({ success: true, count: insertedCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Import via Excel
app.post('/api/creators/import', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        let imported = 0;
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO creators (username, name, category, followers)
            VALUES (?, ?, ?, ?)
        `);

        const insertMany = db.transaction((creators) => {
            for (const creator of creators) {
                if (creator.username || creator.Username) {
                    const username = creator.username || creator.Username;
                    const name = creator.name || creator.Name || '';
                    const category = creator.category || creator.Category || '';
                    const followers = creator.followers || creator.Followers || 0;

                    const info = stmt.run(username, name, category, followers);
                    if (info.changes > 0) imported++;
                }
            }
        });

        insertMany(data);
        res.json({ success: true, imported, total: data.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Real TikTok API Fetch for Creator Metrics
app.post('/api/creators/sync', async (req, res) => {
    const { ids } = req.body;

    if (!ids || !ids.length) {
        return res.status(400).json({ success: false, error: 'No IDs provided' });
    }

    try {
        const getCreatorsStmt = db.prepare(`SELECT id, username FROM creators WHERE id IN (${ids.map(() => '?').join(',')})`);
        const targetCreators = getCreatorsStmt.all(...ids);

        let syncedCount = 0;
        const updateStmt = db.prepare(`
            UPDATE creators 
            SET creator_id = :creator_id, 
                name = :name,
                gmv = :gmv, 
                followers = :followers, 
                engagement_rate = :engagement, 
                avatar_url = :avatar, 
                region = :region,
                category = :category,
                category_id = :category_id
            WHERE id = :id
        `);

        for (const creator of targetCreators) {
            // Call Real TikTok API: /affiliate_seller/202508/marketplace_creators/search
            const tiktokResponse = await makeTikTokApiCall('/affiliate_seller/202508/marketplace_creators/search?page_size=20', 'POST', {
                "keyword": creator.username,
                "search_key": ""
            });

            if (tiktokResponse.code === 0 && tiktokResponse.data?.creators?.length > 0) {
                const apiData = tiktokResponse.data.creators[0];

                let categoryName = null;
                let categoryId = apiData.category_ids?.length > 0 ? apiData.category_ids[0] : null;
                
                if (categoryId) {
                    const catRow = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId);
                    if (catRow) categoryName = catRow.name;
                }

                const params = {
                    creator_id: apiData.creator_open_id || null,
                    name: apiData.nickname || null,
                    gmv: parseFloat(apiData.gmv?.amount || 0),
                    followers: apiData.follower_count || 0,
                    engagement: 0, // Not provided in this endpoint
                    avatar: apiData.avatar?.url || null,
                    region: apiData.selection_region || null,
                    category: categoryName,
                    category_id: categoryId,
                    id: creator.id
                };

                updateStmt.run(params);
                syncedCount++;
            }
        }

        res.json({ success: true, synced: syncedCount, message: 'Sync complete from Official API' });
    } catch (err) {
        console.error('TikTok API Sync Error:', err.response?.data || err.message);
        res.status(500).json({ success: false, error: err.response?.data?.message || err.message });
    }
});

// Real Send Messages using TikTok API
app.post('/api/messages', async (req, res) => {
    const { creatorIds, template, params } = req.body;

    if (!creatorIds || !creatorIds.length || !template) {
        return res.status(400).json({ success: false, error: 'Missing parameters' });
    }

    try {
        const getCreatorsStmt = db.prepare(`SELECT id, username, creator_id, name FROM creators WHERE id IN (${creatorIds.map(() => '?').join(',')})`);
        const creators = getCreatorsStmt.all(...creatorIds);

        const stmt = db.prepare(`
            INSERT INTO messages (creator_id, content, status)
            VALUES (?, ?, ?)
        `);

        let sentCount = 0;

        for (const creator of creators) {
            // Replace template variables
            let content = template.replace(/{name}/g, creator.name || creator.username);
            content = content.replace(/{username}/g, creator.username);

            try {
                if (!creator.creator_id || creator.creator_id.trim() === '') {
                    throw new Error('Creator ID (Open ID) missing. Please Sync this creator first.');
                }

                // First, create a conversation thread with the creator
                const convResponse = await makeTikTokApiCall('/affiliate_seller/202508/conversations', 'POST', {
                    "creator_open_id": creator.creator_id,
                    "only_need_conversation_id": false
                });

                if (convResponse.code === 0 && convResponse.data?.conversation_id) {
                    const conversationId = convResponse.data.conversation_id;

                    // 1. Send Text Message
                    const textContent = JSON.stringify({ "content": content });
                    const textResponse = await makeTikTokApiCall(`/affiliate_seller/202412/conversations/${conversationId}/messages`, 'POST', {
                        "msg_type": "TEXT",
                        "content": textContent
                    });

                    // 2. Send Image Message (if provided)
                    let imageSent = true;
                    if (req.body.image && req.body.image.url) {
                        const imageContent = JSON.stringify({ 
                            "url": req.body.image.url,
                            "width": req.body.image.width || 0,
                            "height": req.body.image.height || 0
                        });
                        const imageResponse = await makeTikTokApiCall(`/affiliate_seller/202412/conversations/${conversationId}/messages`, 'POST', {
                            "msg_type": "IMAGE",
                            "content": imageContent
                        });
                        if (imageResponse.code !== 0) imageSent = false;
                    }

                    if (textResponse.code === 0 && imageSent) {
                        stmt.run(creator.id, content, 'sent');
                        // Update creator status
                        db.prepare('UPDATE creators SET status = ?, last_contacted = CURRENT_TIMESTAMP WHERE id = ?').run('Contacted', creator.id);
                        sentCount++;
                    } else {
                        stmt.run(creator.id, content, 'failed');
                    }
                } else {
                    stmt.run(creator.id, content, 'failed');
                }
            } catch (apiErr) {
                console.error(`Failed to send message to ${creator.username}:`, apiErr.response?.data || apiErr.message);
                stmt.run(creator.id, content, 'failed');
            }
        }

        res.json({ success: true, sent: sentCount, total: creators.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Conversation Management Endpoints
app.get('/api/conversations', async (req, res) => {
    const { page_token, page_size, conversation_status } = req.query;
    try {
        let apiPath = '/affiliate_seller/202412/conversations';
        const params = [];
        params.push(`page_size=${page_size || 20}`);
        params.push(`only_need_conversation_id=false`);
        if (page_token) params.push(`page_token=${page_token}`);
        if (conversation_status && conversation_status !== 'ALL') params.push(`conversation_status=${conversation_status}`);
        if (params.length > 0) apiPath += `?${params.join('&')}`;

        const response = await makeTikTokApiCall(apiPath, 'GET');
        if (response.code === 0) {
            res.json({ success: true, data: response.data || { conversations: [] } });
        } else {
            res.status(400).json({ success: false, error: response.message });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/conversations', async (req, res) => {
    const { creator_open_id } = req.body;
    if (!creator_open_id) {
        return res.status(400).json({ success: false, error: 'creator_open_id is required' });
    }

    try {
        const response = await makeTikTokApiCall('/affiliate_seller/202508/conversations', 'POST', {
            "creator_open_id": creator_open_id,
            "only_need_conversation_id": false
        });

        if (response.code === 0) {
            res.json({ success: true, data: response.data });
        } else {
            res.status(400).json({ success: false, error: response.message });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
    const { id } = req.params;
    const { page_token, page_size } = req.query;
    try {
        let apiPath = `/affiliate_seller/202412/conversation/${id}/messages`;
        const params = [];
        params.push(`page_size=${page_size || 20}`);
        if (page_token) params.push(`page_token=${page_token}`);
        if (params.length > 0) apiPath += `?${params.join('&')}`;

        const response = await makeTikTokApiCall(apiPath, 'GET');
        if (response.code === 0) {
            res.json({ success: true, data: response.data || { messages: [] } });
        } else {
            res.status(400).json({ success: false, error: response.message });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/conversations/unread', async (req, res) => {
    try {
        const response = await makeTikTokApiCall('/affiliate_seller/202412/conversations/messages/list/newest', 'GET');
        if (response.code === 0) {
            res.json({ success: true, data: response.data || { messages: [] } });
        } else {
            res.status(400).json({ success: false, error: response.message });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/conversations/read', async (req, res) => {
    const { conversation_ids } = req.body;
    if (!conversation_ids || !Array.isArray(conversation_ids)) {
        return res.status(400).json({ success: false, error: 'conversation_ids must be an array' });
    }
    
    try {
        const response = await makeTikTokApiCall('/affiliate_seller/202412/conversatons/read', 'POST', {
            conversation_ids: conversation_ids
        });
        
        if (response.code === 0) {
            res.json({ success: true, data: response.data });
        } else {
            res.status(400).json({ success: false, error: response.message });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Image Upload for IM
app.post('/api/conversations/images/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No image uploaded' });
    }

    try {
        const settings = db.prepare('SELECT app_key, app_secret, shop_id, shop_cipher, access_token FROM settings WHERE id = 1').get();
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const apiPath = '/affiliate_seller/202511/images/upload';
        
        const queryParams = {
            app_key: settings.app_key,
            timestamp: timestamp
        };

        // For multipart, TikTok usually doesn't include the body in the signature
        const signature = generateSignature(apiPath, queryParams, null, settings.app_secret);
        
        const sortedKeys = Object.keys(queryParams).sort();
        let finalQueryString = sortedKeys.map(k => `${k}=${encodeURIComponent(queryParams[k])}`).join('&');
        const url = `https://open-api.tiktokglobalshop.com${apiPath}?${finalQueryString}&sign=${signature}`;

        const FormData = require('form-data');
        const fs = require('fs');
        const form = new FormData();
        form.append('data', fs.createReadStream(req.file.path), {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        const response = await axios.post(url, form, {
            headers: {
                ...form.getHeaders(),
                'x-tts-access-token': settings.access_token
            }
        });

        // Clean up temp file
        fs.unlinkSync(req.file.path);

        if (response.data.code === 0) {
            res.json({ success: true, data: response.data.data });
        } else {
            res.status(400).json({ success: false, error: response.data.message });
        }
    } catch (err) {
        console.error('Image Upload Error:', err.response?.data || err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/conversations/:id/messages', async (req, res) => {
    const { id } = req.params;
    const { text, imageUrl, imageData, productId, collabId, applyId } = req.body;
    try {
        let responses = [];
        if (text) {
            const textContent = JSON.stringify({ "content": text });
            responses.push(await makeTikTokApiCall(`/affiliate_seller/202412/conversations/${id}/messages`, 'POST', {
                "msg_type": "TEXT",
                "content": textContent
            }));
        }

        if (imageData && imageData.url) {
            const imageContent = JSON.stringify({ 
                "url": imageData.url,
                "width": parseInt(imageData.width) || 1080,
                "height": parseInt(imageData.height) || 1080
            });
            responses.push(await makeTikTokApiCall(`/affiliate_seller/202412/conversations/${id}/messages`, 'POST', {
                "msg_type": "IMAGE",
                "content": imageContent
            }));
        } else if (imageUrl) {
            const imageContent = JSON.stringify({ "url": imageUrl, "width": 1080, "height": 1080 });
            responses.push(await makeTikTokApiCall(`/affiliate_seller/202412/conversations/${id}/messages`, 'POST', {
                "msg_type": "IMAGE",
                "content": imageContent
            }));
        }

        if (productId) {
            const productContent = JSON.stringify({ "product_id": productId });
            responses.push(await makeTikTokApiCall(`/affiliate_seller/202412/conversations/${id}/messages`, 'POST', {
                "msg_type": "PRODUCT_CARD",
                "content": productContent
            }));
        }

        if (collabId) {
            const collabContent = JSON.stringify({ "target_collaboration_id": collabId });
            responses.push(await makeTikTokApiCall(`/affiliate_seller/202412/conversations/${id}/messages`, 'POST', {
                "msg_type": "TARGET_COLLABORATION_CARD",
                "content": collabContent
            }));
        }

        if (applyId) {
            const applyContent = JSON.stringify({ "apply_id": applyId });
            responses.push(await makeTikTokApiCall(`/affiliate_seller/202412/conversations/${id}/messages`, 'POST', {
                "msg_type": "FREE_SAMPLE_CARD",
                "content": applyContent
            }));
        }

        const failed = responses.find(r => r.code !== 0);
        if (!failed) {
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, error: failed.message });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
app.get('/api/settings', (req, res) => {
    try {
        const stmt = db.prepare('SELECT app_key, app_secret, shop_id, shop_cipher, access_token FROM settings WHERE id = 1');
        const settings = stmt.get() || {};
        res.json({
            success: true,
            data: {
                app_key: settings.app_key || '',
                app_secret: settings.app_secret || '',
                shop_id: settings.shop_id || '',
                shop_cipher: settings.shop_cipher || '',
                is_connected: !!settings.access_token
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/settings', (req, res) => {
    const { app_key, app_secret, shop_id, shop_cipher } = req.body;
    try {
        const stmt = db.prepare(`
            UPDATE settings 
            SET app_key = ?, app_secret = ?, shop_id = ?, shop_cipher = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `);
        stmt.run(app_key || '', app_secret || '', shop_id || '', shop_cipher || '');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Auth Callback (from TikTok OAuth)
app.get('/api/auth/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
        return res.status(400).send('No authorization code provided by TikTok.');
    }

    try {
        const stmt = db.prepare('SELECT app_key, app_secret FROM settings WHERE id = 1');
        const settings = stmt.get();

        if (!settings || !settings.app_key || !settings.app_secret) {
            return res.status(400).send('App Key and App Secret are not configured in settings.');
        }

        // 1. Exchange code for access token
        console.log('Exchanging auth code for tokens...');
        const tokenResponse = await axios.get('https://auth.tiktok-shops.com/api/v2/token/get', {
            params: {
                app_key: settings.app_key,
                app_secret: settings.app_secret,
                auth_code: code,
                grant_type: 'authorized_code'
            }
        });

        const data = tokenResponse.data;

        if (data.code === 0 && data.data) {
            const { access_token, refresh_token, access_token_expire_in } = data.data;

            // 2. Fetch the authorized shop list to get shop_id and shop_cipher
            console.log('Fetching authorized shops...');
            let shopId = '';
            let shopCipher = '';
            try {
                // We use the new access token to call /authorization/202309/shops
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const apiPath = '/authorization/202309/shops';
                const queryParams = {
                    app_key: settings.app_key,
                    timestamp: timestamp
                };
                
                const signature = generateSignature(apiPath, queryParams, null, settings.app_secret);
                const sortedKeys = Object.keys(queryParams).sort();
                const queryString = sortedKeys.map(k => `${k}=${queryParams[k]}`).join('&');
                const url = `https://open-api.tiktokglobalshop.com${apiPath}?${queryString}&sign=${signature}`;

                const shopResponse = await axios.get(url, {
                    headers: {
                        'x-tts-access-token': access_token,
                        'Content-Type': 'application/json'
                    }
                });

                if (shopResponse.data.code === 0 && shopResponse.data.data?.shops?.length > 0) {
                    const shop = shopResponse.data.data.shops[0];
                    shopId = shop.id;
                    shopCipher = shop.cipher;
                    console.log('Successfully retrieved shop_id:', shopId, 'shop_cipher:', shopCipher);
                }
            } catch (shopErr) {
                console.error('Error fetching shop list:', shopErr.response?.data || shopErr.message);
            }

            // 3. Save tokens and shop info to DB
            const updateStmt = db.prepare(`
                UPDATE settings 
                SET access_token = :access_token, 
                    refresh_token = :refresh_token, 
                    access_token_expire_in = :expires_in, 
                    shop_id = :shop_id, 
                    shop_cipher = :shop_cipher, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            `);
            updateStmt.run({
                access_token: access_token || null,
                refresh_token: refresh_token || null,
                expires_in: access_token_expire_in || 0,
                shop_id: shopId || null,
                shop_cipher: shopCipher || null
            });

            // Redirect back to frontend settings page
            res.redirect('http://localhost:5173/settings?success=true');
        } else {
            res.status(400).json({ success: false, error: data.message || 'Failed to get access token from TikTok' });
        }
    } catch (err) {
        console.error('Error fetching TikTok token:', err.response?.data || err.message);
        res.status(500).send('Internal Server Error during token exchange.');
    }
});

// ─── Creator Marketplace Search ───────────────────────────────────────────────
// POST /api/marketplace/search
// Cari creator dari TikTok Marketplace dengan filter lengkap
app.post('/api/marketplace/search', async (req, res) => {
    try {
        const {
            keyword,
            gmv_ranges,
            category,
            follower_min,
            follower_max,
            age_ranges,
            is_fast_growing,
            not_invited_l90_days,
            page_token,
            search_key
        } = req.body;

        // Build filter body sesuai TikTok API spec
        const filterBody = {};

        // Cari tahu nama kategori yang di-request user (untuk sorting nanti)
        let requestedCategoryName = null;
        if (category && category.length > 0) {
            const reqCatId = category[0].parent_category_id;
            if (reqCatId) {
                const reqCatRow = db.prepare('SELECT name FROM categories WHERE id = ?').get(reqCatId);
                if (reqCatRow) requestedCategoryName = reqCatRow.name;
            }
        }

        if (keyword) filterBody.keyword = keyword;
        if (search_key) filterBody.search_key = search_key;
        if (gmv_ranges && gmv_ranges.length > 0) filterBody.gmv_ranges = gmv_ranges;

        // Category filter — TikTok WAJIB ada child_category_id_list jika pakai kategori
        if (category && category.length > 0) {
            const categoryFilters = [];
            for (const cat of category) {
                const parentId = cat.parent_category_id;
                // Kalau sudah ada child list dari frontend, pakai langsung
                if (cat.child_category_id_list && cat.child_category_id_list.length > 0) {
                    categoryFilters.push({
                        parent_category_id: parentId,
                        child_category_id_list: cat.child_category_id_list
                    });
                } else {
                    // Cari child categories dari database lokal
                    const children = db.prepare(
                        'SELECT id FROM categories WHERE parent_id = ?'
                    ).all(parentId);

                    if (children.length > 0) {
                        // Kirim parent + semua child-nya
                        categoryFilters.push({
                            parent_category_id: parentId,
                            child_category_id_list: children.map(c => c.id)
                        });
                    }
                    // Kalau tidak ada child, skip — jangan kirim kategori ini
                    // karena TikTok tidak mau child_category_id_list kosong
                }
            }
            if (categoryFilters.length > 0) {
                filterBody.category = categoryFilters;
            }
        }

        // Follower demographics
        const followerDemographics = {};
        if (age_ranges && age_ranges.length > 0) followerDemographics.age_ranges = age_ranges;
        if (follower_min !== undefined || follower_max !== undefined) {
            followerDemographics.count_range = {};
            if (follower_min !== undefined) followerDemographics.count_range.count_ge = parseInt(follower_min);
            if (follower_max !== undefined && follower_max > 0) followerDemographics.count_range.count_le = parseInt(follower_max);
        }
        if (Object.keys(followerDemographics).length > 0) filterBody.follower_demographics = followerDemographics;

        // Affiliate data filters
        const affiliateData = {};
        if (is_fast_growing) affiliateData.is_fast_growing = true;
        if (not_invited_l90_days) affiliateData.not_invited_l90_days = true;
        if (Object.keys(affiliateData).length > 0) filterBody.affiliate_data = affiliateData;

        // Build URL with pagination
        let apiPath = '/affiliate_seller/202508/marketplace_creators/search?page_size=100';
        if (page_token) apiPath += `&page_token=${encodeURIComponent(page_token)}`;

        console.log("SENDING TO TIKTOK API:", JSON.stringify(filterBody, null, 2));

        const tiktokResponse = await makeTikTokApiCall(apiPath, 'POST', filterBody);

        if (tiktokResponse.code !== 0) {
            return res.status(400).json({ success: false, error: tiktokResponse.message || 'TikTok API error' });
        }

        // Enrich creator data with category names from local DB
        const creators = (tiktokResponse.data?.creators || []).map(creator => {
            let categoryName = null;
            if (creator.category_ids && creator.category_ids.length > 0) {
                const names = [];
                for (const catId of creator.category_ids) {
                    const catRow = db.prepare('SELECT name FROM categories WHERE id = ?').get(catId);
                    if (catRow) {
                        names.push(catRow.name);
                    }
                }
                if (names.length > 0) {
                    // Jika ada kategori yang dicari, paksakan nama tersebut ada di depan
                    // karena TikTok kadang hanya mengembalikan child_id di category_ids
                    if (requestedCategoryName) {
                        const idx = names.indexOf(requestedCategoryName);
                        if (idx > -1) {
                            names.splice(idx, 1);
                        }
                        names.unshift(requestedCategoryName);
                    }
                    // Hilangkan duplikat dan tampilkan maksimal 2 kategori
                    const uniqueNames = [...new Set(names)];
                    categoryName = uniqueNames.slice(0, 2).join(', ') + (uniqueNames.length > 2 ? ', ...' : '');
                }
            }
            return {
                creator_open_id: creator.creator_open_id,
                username: creator.username,
                nickname: creator.nickname,
                avatar_url: creator.avatar?.url || null,
                follower_count: creator.follower_count || 0,
                gmv_amount: creator.gmv?.amount || null,
                gmv_currency: creator.gmv?.currency || null,
                gmv_range: creator.gmv_range?.formatted_range || null,
                region: creator.selection_region || null,
                category_ids: creator.category_ids || [],
                category_name: categoryName,
                avg_video_views: creator.avg_ec_video_view_count || 0,
                avg_live_uv: creator.avg_ec_live_uv || 0,
                ec_video_count: creator.ec_video_count || 0,
                ec_live_count: creator.ec_live_count || 0,
                pps: creator.pps || null,
                rating: creator.rating || null,
            };
        });

        res.json({
            success: true,
            data: {
                creators,
                next_page_token: tiktokResponse.data?.next_page_token || null,
                search_key: tiktokResponse.data?.search_key || null,
                total: creators.length
            }
        });

    } catch (err) {
        console.error('Marketplace search error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// TikTok Webhook Receiver
app.post('/api/webhooks', (req, res) => {
    const signature = req.headers['x-tts-signature'];
    const timestamp = req.headers['x-tts-timestamp'];
    
    // In production, verify the signature using app_secret
    console.log('Received TikTok Webhook:', req.body);
    
    // Respond with 200 to acknowledge receipt
    res.json({ code: 0, message: 'success' });
});

app.listen(port, () => {
    console.log(`Backend server running on port ${port}`);
});
