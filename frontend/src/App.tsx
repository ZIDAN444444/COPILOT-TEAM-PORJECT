import { useState, useEffect } from 'react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Users, MessageSquare, Settings, LayoutDashboard, Globe } from 'lucide-react';
import Dashboard from './components/Dashboard';
import SettingsPage from './components/SettingsPage';
import MessagesPage from './components/MessagesPage';
import MarketplacePage from './components/MarketplacePage';

function Sidebar() {
  const location = useLocation();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await axios.get('http://localhost:3000/api/settings');
        if (res.data.success) {
          setIsConnected(res.data.data.is_connected);
        }
      } catch (err) {
        console.error('Failed to check API status:', err);
      }
    };
    checkStatus();
  }, [location.pathname]);

  return (
    <div className="sidebar">
      <div className="logo">
        <LayoutDashboard className="logo-icon" size={28} />
        <span>AffiliatePro</span>
      </div>

      <div className="nav-links">
        <Link to="/creators" className={`nav-item ${location.pathname === '/creators' || location.pathname === '/' ? 'active' : ''}`}>
          <Users size={20} />
          <span>Creators</span>
        </Link>
        <Link to="/marketplace" className={`nav-item ${location.pathname === '/marketplace' ? 'active' : ''}`}>
          <Globe size={20} />
          <span>Marketplace</span>
        </Link>
        <Link to="/messages" className={`nav-item ${location.pathname === '/messages' ? 'active' : ''}`}>
          <MessageSquare size={20} />
          <span>Messages</span>
        </Link>
        <Link to="/settings" className={`nav-item ${location.pathname === '/settings' ? 'active' : ''}`}>
          <Settings size={20} />
          <span>Settings</span>
        </Link>
      </div>

      <div style={{ marginTop: 'auto', padding: '1.25rem', background: isConnected ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)', borderRadius: '1rem', border: '1px solid var(--border-color)', transition: 'all 0.3s' }}>
        <h4 style={{ fontSize: '0.8125rem', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>TikTok API Status</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem', fontWeight: 600, color: isConnected ? 'var(--success)' : 'var(--danger)' }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: isConnected ? 'var(--success)' : 'var(--danger)'
          }}></div>
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="app-container">
        <Sidebar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/creators" element={<Dashboard />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
