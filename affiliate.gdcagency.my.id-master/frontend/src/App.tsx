import { useState, useEffect } from 'react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Users, MessageSquare, Settings, LayoutDashboard, Globe, Menu, X } from 'lucide-react';
import Dashboard from './components/Dashboard';
import SettingsPage from './components/SettingsPage';
import MessagesPage from './components/MessagesPage';
import MarketplacePage from './components/MarketplacePage';

function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
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

  // Close sidebar on nav click (mobile)
  const handleNavClick = () => {
    onClose();
  };

  return (
    <>
      {/* Overlay for mobile */}
      <div
        className={`sidebar-overlay ${isOpen ? 'visible' : ''}`}
        onClick={onClose}
      />

      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="logo">
          <LayoutDashboard className="logo-icon" size={28} />
          <span>AffiliatePro</span>
        </div>

        <div className="nav-links">
          <Link
            to="/creators"
            className={`nav-item ${location.pathname === '/creators' || location.pathname === '/' ? 'active' : ''}`}
            onClick={handleNavClick}
          >
            <Users size={20} />
            <span>Creators</span>
          </Link>
          <Link
            to="/marketplace"
            className={`nav-item ${location.pathname === '/marketplace' ? 'active' : ''}`}
            onClick={handleNavClick}
          >
            <Globe size={20} />
            <span>Marketplace</span>
          </Link>
          <Link
            to="/messages"
            className={`nav-item ${location.pathname === '/messages' ? 'active' : ''}`}
            onClick={handleNavClick}
          >
            <MessageSquare size={20} />
            <span>Messages</span>
          </Link>
          <Link
            to="/settings"
            className={`nav-item ${location.pathname === '/settings' ? 'active' : ''}`}
            onClick={handleNavClick}
          >
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
              background: isConnected ? 'var(--success)' : 'var(--danger)',
              boxShadow: isConnected ? '0 0 8px var(--success)' : '0 0 8px var(--danger)',
            }}></div>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>
    </>
  );
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Router>
      <div className="app-container">
        {/* Mobile hamburger button */}
        <button
          className="mobile-menu-btn"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle menu"
        >
          {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

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
