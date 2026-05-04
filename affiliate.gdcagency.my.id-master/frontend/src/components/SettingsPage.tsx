import { useState, useEffect } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

export default function SettingsPage() {
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [shopId, setShopId] = useState('');
  const [shopCipher, setShopCipher] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const location = useLocation();

  useEffect(() => {
    // Check if we just redirected back with success
    const params = new URLSearchParams(location.search);
    if (params.get('success') === 'true') {
      alert('Successfully connected to TikTok Shop!');
      // Remove query param from URL without reloading
      window.history.replaceState({}, '', '/settings');
    }
    
    fetchSettings();
  }, [location]);

  const fetchSettings = async () => {
    try {
      const res = await axios.get('http://localhost:3000/api/settings');
      if (res.data.success) {
        setAppKey(res.data.data.app_key || '');
        setAppSecret(res.data.data.app_secret || '');
        setShopId(res.data.data.shop_id || '');
        setShopCipher(res.data.data.shop_cipher || '');
        setIsConnected(res.data.data.is_connected);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await axios.post('http://localhost:3000/api/settings', {
        app_key: appKey,
        app_secret: appSecret,
        shop_id: shopId,
        shop_cipher: shopCipher
      });
      alert('Settings saved successfully!');
      fetchSettings();
    } catch (err) {
      console.error(err);
      alert('Failed to save settings');
    }
  };

  const handleConnect = () => {
    if (!appKey || !appSecret) {
      return alert('Please save your App Key and App Secret first!');
    }
    // Redirect to TikTok Shop OAuth Authorization URL
    const redirectUri = encodeURIComponent('http://localhost:3000/api/auth/callback');
    const authUrl = `https://services.tiktokshop.com/open/authorize?app_key=${appKey}&state=connect_request&redirect_uri=${redirectUri}`;
    
    window.location.href = authUrl;
  };

  if (loading) return <div className="main-content">Loading...</div>;

  return (
    <div className="main-content">
      <h1>Settings</h1>
      <p style={{ color: 'var(--text-muted)' }}>Configure your TikTok Shop Partner API integrations</p>
      
      <div className="glass-card" style={{ maxWidth: '600px', marginTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3>API Configuration</h3>
          {isConnected ? (
            <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
              ✓ Authorized
            </span>
          ) : (
            <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)' }}>
              Not Authorized
            </span>
          )}
        </div>
        
        <div className="form-group">
          <label>TikTok App Key</label>
          <input 
            type="text" 
            placeholder="Enter App Key" 
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>TikTok App Secret</label>
          <input 
            type="password" 
            placeholder="Enter App Secret" 
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
          />
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Shop ID</label>
            <input 
              type="text" 
              placeholder="Shop ID" 
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Shop Cipher (Required for Sync)</label>
            <input 
              type="text" 
              placeholder="Shop Cipher" 
              value={shopCipher}
              onChange={(e) => setShopCipher(e.target.value)}
            />
          </div>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          Identifiers are retrieved automatically during connection.
        </p>
        
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={handleSave}>
            Save Settings
          </button>
          
          <button 
            className={`btn ${isConnected ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleConnect}
          >
            {isConnected ? 'Reconnect with TikTok Shop' : 'Connect with TikTok Shop'}
          </button>
        </div>
      </div>
    </div>
  );
}
