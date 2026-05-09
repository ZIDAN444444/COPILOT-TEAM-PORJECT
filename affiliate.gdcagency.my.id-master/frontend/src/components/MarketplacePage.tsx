import { useState, useEffect, useRef } from 'react';
import { Search, Globe, Plus, Check, Filter, RefreshCw, AlertCircle, TrendingUp, Users, Zap, Rocket, Mail, FolderOpen, DollarSign } from 'lucide-react';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

const GMV_RANGES = [
  { label: 'Rp 0 – Rp 1,5jt', value: 'GMV_RANGE_0_100' },
  { label: 'Rp 1,5jt – Rp 15jt', value: 'GMV_RANGE_100_1000' },
  { label: 'Rp 15jt – Rp 150jt', value: 'GMV_RANGE_1000_10000' },
  { label: 'Rp 150jt+', value: 'GMV_RANGE_10000_AND_ABOVE' },
];

const FOLLOWER_PRESETS = [
  { label: 'Semua', min: 0, max: 0 },
  { label: '1K – 10K', min: 1000, max: 10000 },
  { label: '10K – 100K', min: 10000, max: 100000 },
  { label: '100K – 1M', min: 100000, max: 1000000 },
  { label: '1M+', min: 1000000, max: 0 },
];

function formatNumber(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n?.toString() || '0';
}



export default function MarketplacePage() {
  const [creators, setCreators] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [searchKey, setSearchKey] = useState('');
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<any[]>([]);

  // Filters
  const [keyword, setKeyword] = useState('');
  const [selectedGmv, setSelectedGmv] = useState<string[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [followerPreset, setFollowerPreset] = useState(0);
  const [isFastGrowing, setIsFastGrowing] = useState(false);
  const [notInvited, setNotInvited] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [targetCount, setTargetCount] = useState<number>(20);
  const [searchProgress, setSearchProgress] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Ambil Wake Lock agar layar tidak mati saat pencarian
  const acquireWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('Wake Lock aktif: Layar tidak akan mati selama pencarian.');
      } catch (e) {
        console.warn('Wake Lock tidak bisa diaktifkan:', e);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
      console.log('Wake Lock dilepas.');
    }
  };

  // Fungsi untuk membatalkan pencarian yang sedang berjalan
  const handleCancelSearch = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    releaseWakeLock();
    setLoading(false);
    setError('');
  };

  useEffect(() => {
    axios.get(`${API_URL}/categories`).then(res => {
      if (res.data.success) {
        // Hanya ambil kategori utama (parent_id = '0') agar dropdown tidak kepanjangan
        const parentCategories = (res.data.data || []).filter((cat: any) => cat.parent_id === '0');
        setCategories(parentCategories);
      }
    }).catch(() => {});
  }, []);

  const handleSearch = async (isLoadMore = false) => {
    // Batalkan request sebelumnya jika ada
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError('');
    setSearchProgress('Memulai koneksi real-time ke server TikTok...');
    acquireWakeLock(); // Cegah layar mati selama pencarian
    if (!isLoadMore) {
      setCreators([]);
      setNextPageToken(null);
      setSearchKey('');
    }

    try {
      const preset = FOLLOWER_PRESETS[followerPreset];
      const payload: any = {
        keyword: keyword.trim(),
        gmv_ranges: selectedGmv,
        is_fast_growing: isFastGrowing,
        not_invited_l90_days: notInvited,
        search_key: isLoadMore ? searchKey : '',
        page_token: isLoadMore ? nextPageToken : undefined,
        target_count: isLoadMore ? 20 : targetCount,
      };

      if (preset.min > 0) payload.follower_min = preset.min;
      if (preset.max > 0) payload.follower_max = preset.max;

      if (selectedCategoryId) {
        payload.category = [{ parent_category_id: selectedCategoryId }];
      }

      const response = await fetch(`${API_URL}/marketplace/search/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errData;
        try { errData = await response.json(); } catch(e) { errData = { error: 'Terjadi kesalahan jaringan' }; }
        throw new Error(errData.error || `HTTP Error ${response.status}`);
      }

      if (!response.body) throw new Error('Browser tidak mendukung real-time streaming');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete chunk in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'progress') {
              setSearchProgress(data.message);
            } else if (data.type === 'creators') {
              setCreators(prev => {
                const combined = [...prev, ...data.creators];
                const seen = new Set();
                return combined.filter(c => {
                  const uid = c.creator_open_id || c.username;
                  if (seen.has(uid)) return false;
                  seen.add(uid);
                  return true;
                });
              });
            } else if (data.type === 'done') {
              setNextPageToken(data.next_page_token || null);
              setSearchKey(data.search_key || '');
            } else if (data.type === 'error') {
              setError(data.error);
            }
          } catch (e) {
            console.error('Error parsing streaming line:', e);
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Terjadi kesalahan');
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setSearchProgress('');
      releaseWakeLock(); // Lepas wake lock setelah selesai
    }
  };

  const handleBatchAddCreators = async () => {
    if (selectedIds.size === 0) return;
    const selectedCreators = creators.filter(c => {
      const uid = c.creator_open_id || c.username;
      return selectedIds.has(uid) && !addedIds.has(uid);
    });

    if (selectedCreators.length === 0) return;

    try {
      const payload = selectedCreators.map(creator => ({
        username: creator.username,
        name: creator.nickname || creator.username,
        category: creator.category_name || '',
        gmv: parseFloat(creator.gmv_amount || 0),
        gmv_range: creator.gmv_range || '',
        followers: creator.follower_count || 0,
        region: creator.region || '',
        avatar_url: creator.avatar_url || '',
        creator_id: creator.creator_open_id || ''
      }));

      await axios.post(`${API_URL}/creators/batch`, { creators: payload });
      
      setAddedIds(prev => {
        const next = new Set(prev);
        selectedCreators.forEach(c => next.add(c.creator_open_id || c.username));
        return next;
      });
      setSelectedIds(new Set());
      alert(`Berhasil menyimpan ${selectedCreators.length} creator!`);
    } catch (err: any) {
      alert('Gagal menambahkan creator masal: ' + (err.response?.data?.error || err.message));
    }
  };

  const toggleSelectAll = () => {
    const selectableIds = new Set(
      creators
        .map(c => c.creator_open_id || c.username)
        .filter(uid => !addedIds.has(uid))
    );
    if (selectedIds.size === selectableIds.size && selectableIds.size > 0) {
      setSelectedIds(new Set()); // Deselect all
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  };

  const toggleSelect = (uid: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const toggleGmv = (val: string) => {
    setSelectedGmv(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  };

  return (
    <div className="main-content" style={{ overflow: 'hidden', paddingBottom: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="header" style={{ marginBottom: '-0.5rem' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.5rem' }}>
            <Globe size={22} style={{ color: 'var(--accent)' }} />
            Creator Discovery
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.25rem', fontSize: '0.8rem' }}>
            Temukan creator TikTok dari Marketplace • Data 30 hari terakhir
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setShowFilters(f => !f)}
          style={{ gap: '0.5rem', padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
        >
          <Filter size={14} />
          {showFilters ? 'Sembunyikan' : 'Filter'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'stretch', flex: 1, minHeight: 0, paddingBottom: '1.5rem' }}>

        {/* Filter Panel */}
        {showFilters && (
          <div style={{
            width: 230, flexShrink: 0,
            background: 'var(--panel-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            padding: '1rem',
            display: 'flex', flexDirection: 'column', gap: '1rem',
            overflowY: 'auto',
            minWidth: 200,
          }} className="filter-panel no-scrollbar">
            {/* Search Button (Moved to top) */}
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.6rem', fontSize: '0.875rem', borderRadius: 8, position: 'relative', overflow: 'hidden', flexShrink: 0, marginBottom: '0.25rem' }}
              onClick={() => loading ? handleCancelSearch() : handleSearch(false)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                {loading ? <RefreshCw size={15} className="spin" /> : <Search size={15} />}
                {loading ? 'Batalkan Pencarian' : 'Cari Creator'}
              </div>
            </button>

            {/* Keyword */}
            <div>

              <div className="search-bar" style={{ height: 34 }}>
                <Search size={13} />
                <input
                  type="text"
                  placeholder="Username atau nama..."
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  style={{ fontSize: '0.85rem' }}
                />
              </div>
            </div>

            {/* GMV Filter */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <DollarSign size={16} style={{ color: 'var(--text-muted)', marginTop: '0.2rem', flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1 }}>
                {GMV_RANGES.map(r => (
                  <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', padding: '0.2rem 0' }}>
                    <input
                      type="checkbox"
                      checked={selectedGmv.includes(r.value)}
                      onChange={() => toggleGmv(r.value)}
                      style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Category Filter */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <FolderOpen size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <select
                className="select-filter"
                style={{ width: '100%', height: 34, fontSize: '0.85rem' }}
                value={selectedCategoryId}
                onChange={e => setSelectedCategoryId(e.target.value)}
              >
                <option value="">Semua Kategori</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            {/* Followers */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Users size={16} style={{ color: 'var(--text-muted)', marginTop: '0.2rem', flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1 }}>
                {FOLLOWER_PRESETS.map((p, i) => (
                  <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', padding: '0.2rem 0' }}>
                    <input
                      type="radio"
                      name="follower"
                      checked={followerPreset === i}
                      onChange={() => setFollowerPreset(i)}
                      style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Target Count */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <TrendingUp size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <select
                className="select-filter"
                style={{ width: '100%', height: 34, fontSize: '0.85rem' }}
                value={targetCount}
                onChange={e => setTargetCount(Number(e.target.value))}
              >
                <option value={20}>20 Kreator</option>
                <option value={100}>100 Kreator</option>
                <option value={200}>200 Kreator</option>
                <option value={500}>500 Kreator</option>
                <option value={1000}>1000 Kreator</option>
              </select>
            </div>

            {/* Advanced Filters */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Zap size={16} style={{ color: 'var(--text-muted)', marginTop: '0.2rem', flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={isFastGrowing}
                    onChange={e => setIsFastGrowing(e.target.checked)}
                    style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                  />
                  <Rocket size={13} style={{ display: 'inline', verticalAlign: 'middle' }} /> Fast Growing
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={notInvited}
                    onChange={e => setNotInvited(e.target.checked)}
                    style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                  />
                  <Mail size={13} style={{ display: 'inline', verticalAlign: 'middle' }} /> Belum Diundang 90h
                </label>
              </div>
            </div>

          </div>
        )}

        {/* Results Panel */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1rem',
              display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#fca5a5'
            }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {/* Empty State */}
          {!loading && creators.length === 0 && !error && (
            <div style={{
              textAlign: 'center', padding: '5rem 2rem',
              background: 'var(--panel-bg)', borderRadius: 12, border: '1px solid var(--border-color)'
            }}>
              <Globe size={56} style={{ color: 'var(--text-muted)', marginBottom: '1rem', opacity: 0.4 }} />
              <h3 style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Belum Ada Hasil</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
                Pilih filter di panel kiri lalu klik <strong>"Cari Creator"</strong>
              </p>
            </div>
          )}

          {/* Cool Loading Animation - Pindah ke Atas Tabel */}
          {loading && (
            <div style={{ 
              padding: '1.25rem 1.5rem', 
              display: 'flex', flexDirection: 'row', 
              alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap',
              background: 'var(--panel-bg)', borderRadius: 12, border: '1px solid var(--border-color)',
              marginBottom: '1.5rem', boxShadow: '0 4px 15px rgba(0,0,0,0.05)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flex: 1, minWidth: 200 }}>
                <div style={{ position: 'relative', width: '40px', height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', width: '100%', height: '100%', border: '3px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  <div style={{ position: 'absolute', width: '70%', height: '70%', border: '3px solid rgba(59, 130, 246, 0.5)', borderBottomColor: 'transparent', borderRadius: '50%', animation: 'spin 1.5s linear infinite reverse' }} />
                  <Globe size={18} style={{ color: 'var(--accent)', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
                </div>
                <div>
                  <h3 style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: '1rem', marginBottom: '0.2rem' }}>Mencari Kreator...</h3>
                  {searchProgress ? (
                    <div style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.85rem' }}>
                      {searchProgress}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                      Sistem sedang menarik data secara bertahap...
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
  
          {/* Results Count & Batch Action */}
          {creators.length > 0 && (
            <div style={{ 
              marginBottom: '1rem', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              background: selectedIds.size > 0 ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
              padding: selectedIds.size > 0 ? '0.75rem 1rem' : '0',
              borderRadius: 8,
              transition: 'all 0.2s',
              border: selectedIds.size > 0 ? '1px solid rgba(59, 130, 246, 0.3)' : 'none'
            }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Menampilkan <strong style={{ color: 'var(--text-main)' }}>{creators.length}</strong> creator
                {addedIds.size > 0 && (
                  <span style={{ marginLeft: '1rem', color: 'var(--success)' }}>
                    • <strong>{addedIds.size}</strong> sudah tersimpan
                  </span>
                )}
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                {/* Pilih Semua / Batal Semua */}
                {creators.filter(c => !addedIds.has(c.creator_open_id || c.username)).length > 0 && (
                  (() => {
                    const selectableIds = new Set(
                      creators
                        .map(c => c.creator_open_id || c.username)
                        .filter(uid => !addedIds.has(uid))
                    );
                    const isAllSelected = selectableIds.size > 0 && selectedIds.size === selectableIds.size;
                    
                    return (
                      <>
                        {isAllSelected ? (
                          <button
                            className="btn btn-secondary"
                            onClick={() => setSelectedIds(new Set())}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                          >
                            <RefreshCw size={14} /> Batal Pilih Semua
                          </button>
                        ) : (
                          <button
                            className="btn btn-secondary"
                            onClick={() => setSelectedIds(new Set(selectableIds))}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                          >
                            <Check size={14} /> Pilih Semua ({selectableIds.size})
                          </button>
                        )}
                        {/* Tombol Batal Terpilih */}
                        {selectedIds.size > 0 && !isAllSelected && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => setSelectedIds(new Set())}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', fontSize: '0.875rem', color: '#ef4444' }}
                          >
                            <RefreshCw size={14} /> Batal Pilihan ({selectedIds.size})
                          </button>
                        )}
                      </>
                    );
                  })()
                )}

                {/* Simpan Terpilih */}
                {selectedIds.size > 0 && (
                  <button
                    className="btn btn-primary"
                    onClick={handleBatchAddCreators}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                  >
                    <Check size={16} />
                    Simpan {selectedIds.size} Terpilih
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Creator Table */}
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--panel-bg)', borderRadius: 12, border: '1px solid var(--border-color)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--panel-bg)', boxShadow: '0 1px 0 var(--border-color)' }}>
                <tr>
                  <th style={{ padding: '1rem', width: 40 }}>
                    <input 
                      type="checkbox" 
                      style={{ accentColor: 'var(--accent)', width: 16, height: 16, cursor: 'pointer' }}
                      checked={(() => {
                        const selectableIds = new Set(
                          creators
                            .map(c => c.creator_open_id || c.username)
                            .filter(uid => !addedIds.has(uid))
                        );
                        return selectableIds.size > 0 && selectedIds.size === selectableIds.size;
                      })()}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Creator</th>
                  <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}>GMV 30d</th>
                  <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Followers</th>
                  <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Kategori</th>
                  <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {creators.map((creator, idx) => {
                  const uid = creator.creator_open_id || creator.username || idx;
                  const isAdded = addedIds.has(uid);
                  const initials = (creator.nickname || creator.username || '?').charAt(0).toUpperCase();

                  return (
                    <tr key={uid + idx} style={{ 
                        borderBottom: '1px solid var(--border-color)', 
                        transition: 'background 0.2s',
                        background: selectedIds.has(uid) ? 'rgba(59, 130, 246, 0.05)' : 'transparent'
                      }}
                        onMouseEnter={e => (e.currentTarget.style.background = selectedIds.has(uid) ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255,255,255,0.03)')}
                        onMouseLeave={e => (e.currentTarget.style.background = selectedIds.has(uid) ? 'rgba(59, 130, 246, 0.05)' : 'transparent')}>
                      <td style={{ padding: '1rem' }}>
                        <input 
                          type="checkbox" 
                          style={{ accentColor: 'var(--accent)', width: 16, height: 16, cursor: isAdded ? 'not-allowed' : 'pointer' }}
                          checked={selectedIds.has(uid) || isAdded}
                          disabled={isAdded}
                          onChange={() => toggleSelect(uid)}
                        />
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{
                            width: 44, height: 44, borderRadius: '50%',
                            background: creator.avatar_url ? 'transparent' : 'var(--accent)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, color: 'white', fontSize: '1rem',
                            overflow: 'hidden', flexShrink: 0,
                            border: '1px solid var(--border-color)'
                          }}>
                            {creator.avatar_url
                              ? <img src={creator.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : initials}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              {creator.nickname || creator.username}
                              {creator.region && (
                                <span style={{
                                  fontSize: '0.65rem', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', padding: '0.1rem 0.3rem', borderRadius: 4
                                }}>{creator.region}</span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>@{creator.username}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: 700, color: 'var(--success)' }}>
                          {creator.gmv_amount 
                            ? (() => {
                                const amount = parseFloat(creator.gmv_amount);
                                if (creator.gmv_currency === 'USD') {
                                   return `Rp${(amount * 15500).toLocaleString('id-ID')}`;
                                }
                                if (creator.gmv_currency === 'IDR') {
                                   return `Rp${amount.toLocaleString('id-ID')}`;
                                }
                                return `${creator.gmv_currency || '$'}${amount.toLocaleString('en-US')}`;
                              })()
                            : (creator.gmv_range 
                                ? (creator.region === 'ID' ? creator.gmv_range.replace(/\$/g, 'Rp') : creator.gmv_range) 
                                : '–')}
                        </div>
                      </td>
                      <td style={{ padding: '1rem', fontWeight: 600 }}>{formatNumber(creator.follower_count)}</td>
                      <td style={{ padding: '1rem' }}>
                        {creator.category_name && (
                          <span style={{
                            fontSize: '0.75rem', fontWeight: 600, background: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)',
                            padding: '0.2rem 0.5rem', borderRadius: 4, display: 'inline-block', maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                          }}>
                            {creator.category_name}
                          </span>
                        )}
                        {(creator.pps || creator.rating) && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                            {creator.rating && <span style={{ marginRight: '0.5rem' }}>⭐ {creator.rating}</span>}
                            {creator.pps && <span>⚡ {creator.pps}</span>}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {isAdded ? (
                          <span style={{
                            padding: '0.4rem 0.8rem', borderRadius: 6,
                            background: 'rgba(16,185,129,0.15)', color: 'var(--success)',
                            fontWeight: 600, fontSize: '0.8rem',
                            display: 'flex', alignItems: 'center', gap: '0.4rem'
                          }}>
                            <Check size={14} /> Tersimpan
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedIds(new Set([uid]));
                              setTimeout(() => handleBatchAddCreators(), 0);
                            }}
                            style={{
                              padding: '0.4rem 0.8rem', borderRadius: 6, border: 'none',
                              cursor: 'pointer', background: 'var(--accent)', color: 'white',
                              fontWeight: 600, fontSize: '0.8rem',
                              display: 'flex', alignItems: 'center', gap: '0.4rem', transition: 'all 0.2s',
                            }}
                          >
                            <Plus size={14} /> Simpan
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>


          </div>



        </div>
      </div>
    </div>
  );
}
