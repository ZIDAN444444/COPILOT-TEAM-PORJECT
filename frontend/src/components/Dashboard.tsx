import { useState, useEffect } from 'react';
import { Search, Filter, MessageSquare, Download, Upload, Plus, Users, DollarSign, Activity, X } from 'lucide-react';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

export default function Dashboard() {
  const [creators, setCreators] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  
  // New creator form
  const [newCreator, setNewCreator] = useState({ username: '', name: '', category: '', gmv: '', followers: '' });
  const [messageTemplate, setMessageTemplate] = useState('Hi {name}, would love to collaborate on TikTok Shop!');
  const [messageImage, setMessageImage] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const fetchCreators = async () => {
    try {
      const res = await axios.get(`${API_URL}/creators`, {
        params: { search, category }
      });
      setCreators(res.data.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await axios.get(`${API_URL}/categories`);
      if (res.data.success) {
        setCategories(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  useEffect(() => {
    fetchCreators();
  }, [search, category]);

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelected(new Set(creators.map(c => c.id)));
    } else {
      setSelected(new Set());
    }
  };

  const handleSelect = (id) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const handleAddCreator = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/creators`, newCreator);
      setShowAddModal(false);
      setNewCreator({ username: '', name: '', category: '', gmv: '', followers: '' });
      fetchCreators();
    } catch (err) {
      console.error(err);
      alert('Error adding creator');
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (selected.size === 0) return alert('Select creators first');
    try {
      await axios.post(`${API_URL}/messages`, {
        creatorIds: Array.from(selected),
        template: messageTemplate,
        image: messageImage
      });
      setShowMessageModal(false);
      setMessageImage(null);
      alert('Messages queued successfully!');
      setSelected(new Set());
    } catch (err) {
      console.error(err);
      alert('Error sending messages');
    }
  };

  const handleSync = async () => {
    if (selected.size === 0) return alert('Select creators first');
    setSyncing(true);
    try {
      await axios.post(`${API_URL}/creators/sync`, {
        ids: Array.from(selected)
      });
      fetchCreators();
      alert('Sync complete!');
    } catch (err) {
      console.error(err);
      alert('Sync failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setSyncing(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    setImporting(true);
    try {
      const res = await axios.post(`${API_URL}/creators/import`, formData);
      alert(`Imported ${res.data.imported} creators!`);
      fetchCreators();
    } catch (err) {
      console.error(err);
      alert('Import failed');
    } finally {
      setImporting(false);
    }
  };

  const totalGMV = creators.reduce((acc, curr) => acc + (curr.gmv || 0), 0);

  return (
    <div className="main-content">
      <div className="header">
        <div>
          <h1>Affiliate Creators</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Manage your TikTok Shop affiliate partnerships</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowMessageModal(true)} disabled={selected.size === 0}>
            <MessageSquare size={18} />
            Message ({selected.size})
          </button>
          <button className="btn btn-secondary" onClick={handleSync} disabled={selected.size === 0 || syncing}>
            <Activity size={18} className={syncing ? 'spin' : ''} />
            {syncing ? 'Syncing...' : `Sync Stats (${selected.size})`}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={18} />
            Add Creator
          </button>
        </div>
      </div>

      <div className="stats-row">
        <div className="glass-card stat-card">
          <div className="stat-icon">
            <Users size={24} />
          </div>
          <div className="stat-info">
            <h3>Total Creators</h3>
            <div className="value">{creators.length}</div>
          </div>
        </div>
        <div className="glass-card stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}>
            <DollarSign size={24} />
          </div>
          <div className="stat-info">
            <h3>Total GMV</h3>
            <div className="value">${totalGMV.toLocaleString()}</div>
          </div>
        </div>
        <div className="glass-card stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)' }}>
            <Activity size={24} />
          </div>
          <div className="stat-info">
            <h3>Avg Engagement</h3>
            <div className="value">
              {(creators.reduce((acc, curr) => acc + (curr.engagement_rate || 0), 0) / (creators.length || 1)).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card">
        <div className="toolbar">
          <div className="search-bar">
            <Search size={18} />
            <input 
              type="text" 
              placeholder="Search by username or name..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select 
            className="select-filter"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories?.map(cat => (
              <option key={cat.id} value={cat.name}>{cat.name}</option>
            ))}
          </select>
          <label className="btn btn-secondary" style={{ marginLeft: 'auto', cursor: 'pointer' }}>
            <Upload size={18} />
            {importing ? 'Importing...' : 'Import CSV/Excel'}
            <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={handleImport} disabled={importing} />
          </label>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input 
                    type="checkbox" 
                    onChange={handleSelectAll}
                    checked={selected.size === creators.length && creators.length > 0}
                  />
                </th>
                <th>Creator</th>
                <th>Category</th>
                <th>Followers</th>
                <th>Region</th>
                <th>GMV (30d)</th>
                <th>Engagement</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {creators?.map(creator => (
                <tr key={creator.id}>
                  <td>
                    <input 
                      type="checkbox" 
                      checked={selected.has(creator.id)}
                      onChange={() => handleSelect(creator.id)}
                    />
                  </td>
                  <td>
                    <div className="creator-info">
                      <div className="avatar">
                        {creator.avatar_url ? (
                          <img src={creator.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          (creator.name || creator.username).charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="creator-details">
                        <span className="creator-name">{creator.name || creator.username}</span>
                        <span className="creator-username">@{creator.username}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge">{creator.category || 'Uncategorized'}</span>
                  </td>
                  <td>{creator.followers?.toLocaleString() || 0}</td>
                  <td>{creator.region || '-'}</td>
                  <td style={{ fontWeight: 600, color: 'var(--success)' }}>
                    ${creator.gmv?.toLocaleString() || 0}
                  </td>
                  <td>{creator.engagement_rate || 0}%</td>
                  <td>
                    <span className={`badge ${
                      creator.status === 'Contacted' ? 'badge-green' : 
                      creator.status === 'Interested' ? 'badge-blue' :
                      creator.status === 'Collaborating' ? 'badge-orange' : 'badge-gray'
                    }`}>
                      {creator.status || 'Not Contacted'}
                    </span>
                  </td>
                </tr>
              ))}
              {creators.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    No creators found. Try adding some or adjusting your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Creator Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">Add New Creator</h2>
              <button className="close-btn" onClick={() => setShowAddModal(false)}>
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddCreator}>
              <div className="form-group">
                <label>TikTok Username *</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. charlidamelio"
                  value={newCreator.username}
                  onChange={e => setNewCreator({...newCreator, username: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Full Name</label>
                <input 
                  type="text" 
                  placeholder="Charli D'Amelio"
                  value={newCreator.name}
                  onChange={e => setNewCreator({...newCreator, name: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select 
                  className="select-filter" 
                  style={{ width: '100%' }}
                  value={newCreator.category}
                  onChange={e => setNewCreator({...newCreator, category: e.target.value})}
                >
                  <option value="">Select Category...</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Creator</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Send Message Modal */}
      {showMessageModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">Send Bulk Message</h2>
              <button className="close-btn" onClick={() => setShowMessageModal(false)}>
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSendMessage}>
              <div className="form-group">
                <label>Message Template</label>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Use {'{name}'} or {'{username}'} for personalization.
                </p>
                <textarea 
                  rows={4}
                  required
                  value={messageTemplate}
                  onChange={e => setMessageTemplate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Add Image (Optional)</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                    <Upload size={18} />
                    {uploadingImage ? 'Uploading...' : 'Choose Image'}
                    <input 
                      type="file" 
                      hidden 
                      accept="image/*" 
                      onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        setUploadingImage(true);
                        const formData = new FormData();
                        formData.append('image', file);
                        try {
                          const res = await axios.post(`${API_URL}/conversations/images/upload`, formData);
                          setMessageImage(res.data.data);
                        } catch (err) {
                          alert('Failed to upload image');
                        } finally {
                          setUploadingImage(false);
                        }
                      }} 
                    />
                  </label>
                  {messageImage && (
                    <div style={{ position: 'relative' }}>
                      <img src={messageImage.url || messageImage} alt="Preview" style={{ height: '40px', borderRadius: '4px' }} />
                      <button 
                        type="button" 
                        onClick={() => setMessageImage(null)}
                        style={{ position: 'absolute', top: -8, right: -8, background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowMessageModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Send to {selected.size} Creators</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
