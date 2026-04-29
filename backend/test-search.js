const axios = require('axios');
const crypto = require('crypto');
const db = require('./db');

const generateSignature = (apiPath, queryParams, body, appSecret) => {
    const keys = Object.keys(queryParams).filter(key => key !== 'sign' && key !== 'access_token').sort();
    let paramString = '';
    for (const key of keys) {
        paramString += `${key}${queryParams[key]}`;
    }
    let signString = `${apiPath}${paramString}`;
    if (body && Object.keys(body).length > 0) {
        signString += JSON.stringify(body);
    }
    const wrappedString = `${appSecret}${signString}${appSecret}`;
    return crypto.createHmac('sha256', appSecret).update(wrappedString).digest('hex');
};

async function test() {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const apiPath = '/affiliate_seller/202508/marketplace_creators/search';
    const queryParams = {
        app_key: settings.app_key,
        timestamp: timestamp,
        shop_cipher: settings.shop_cipher,
        page_size: 20
    };

    const payload = {
        "keyword": "okediilservice",
        "search_key": ""
    };

    const signature = generateSignature(apiPath, queryParams, payload, settings.app_secret);
    
    const sortedKeys = Object.keys(queryParams).sort();
    let finalQueryString = sortedKeys.map(k => `${k}=${encodeURIComponent(queryParams[k])}`).join('&');
    const url = `https://open-api.tiktokglobalshop.com${apiPath}?${finalQueryString}&sign=${signature}`;

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'x-tts-access-token': settings.access_token,
                'Content-Type': 'application/json'
            }
        });
        console.log(JSON.stringify(response.data, null, 2));
    } catch (e) {
        console.error(e.response?.data || e.message);
    }
}

test();
