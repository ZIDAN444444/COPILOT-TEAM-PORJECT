import { useState, useEffect, useRef } from 'react';
import { Search, Send, Image as ImageIcon, MoreVertical, CheckCheck, MessageSquare, Paperclip, Package, FileText, Gift, Loader2 } from 'lucide-react';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

export default function MessagesPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [snippetsFetched, setSnippetsFetched] = useState(new Set());
  
  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [convStatus, setConvStatus] = useState('ALL');
  
  // Pagination
  const [convPageToken, setConvPageToken] = useState('');
  const [convHasMore, setConvHasMore] = useState(false);
  const [msgPageToken, setMsgPageToken] = useState('');
  const [msgHasMore, setMsgHasMore] = useState(false);
  
  // States
  const [loading, setLoading] = useState(true);
  const [loadingMoreConvs, setLoadingMoreConvs] = useState(false);
  const [loadingMoreMsgs, setLoadingMoreMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  
  // Image & Attachments
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [showAttachments, setShowAttachments] = useState(false);
  const [attachmentData, setAttachmentData] = useState({ type: null, id: '' });
  const [localImageCache, setLocalImageCache] = useState({});
  


  const fetchConversations = async (loadMore = false) => {
    try {
      if (loadMore) {
        setLoadingMoreConvs(true);
      } else {
        setLoading(true);
      }
      
      const token = loadMore ? convPageToken : '';
      const res = await axios.get(`${API_URL}/conversations`, {
        params: { page_size: 20, page_token: token, conversation_status: convStatus }
      });

      if (res.data.success) {
        const data = res.data.data;
        const convs = data.conversations || [];
        setConvHasMore(data.has_more);
        setConvPageToken(data.next_page_token || '');
        
        let updatedConvs = loadMore ? [...conversations, ...convs] : convs;
        
        // Fetch latest unread messages to augment the snippets (for first page only or globally)
        const unreadRes = await axios.get(`${API_URL}/conversations/unread`);
        if (unreadRes.data.success && unreadRes.data.data.newest_message_list) {
           const unreadMap = {};
           unreadRes.data.data.newest_message_list.forEach(msg => {
             unreadMap[msg.conversation_id] = msg;
           });
           updatedConvs = updatedConvs.map(c => {
             if (unreadMap[c.id]) {
                return { ...c, latest_message: unreadMap[c.id] };
             }
             return c;
           });
        }
        
        
        setConversations(updatedConvs);

        // Fetch snippets in background for conversations that don't have them
        const missingSnippets = updatedConvs.filter(c => !c.latest_message && !snippetsFetched.has(c.id));
        if (missingSnippets.length > 0) {
          missingSnippets.forEach(async (c, idx) => {
            setSnippetsFetched(prev => new Set(prev).add(c.id));
            setTimeout(async () => {
              try {
                const snipRes = await axios.get(`${API_URL}/conversations/${c.id}/messages`, { params: { page_size: 1 } });
                if (snipRes.data.success && snipRes.data.data.messages?.length > 0) {
                  setConversations(prevConvs => prevConvs.map(pc => pc.id === c.id ? { ...pc, latest_message: snipRes.data.data.messages[0] } : pc));
                }
              } catch (e) { /* ignore */ }
            }, idx * 300); // Stagger requests to avoid rate limits
          });
        }

      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoading(false);
      setLoadingMoreConvs(false);
    }
  };

  const fetchMessages = async (conv, loadMore = false) => {
    if (!conv) return;
    try {
      if (loadMore) setLoadingMoreMsgs(true);
      const token = loadMore ? msgPageToken : '';
      const res = await axios.get(`${API_URL}/conversations/${conv.id}/messages`, {
        params: { page_size: 20, page_token: token }
      });

      if (res.data.success) {
        const data = res.data.data;
        const fetchedMsgs = data.messages || [];
        // Sort oldest first so that newest messages are at the bottom
        fetchedMsgs.sort((a, b) => a.create_time - b.create_time);

        setMessages(prev => loadMore ? [...fetchedMsgs, ...prev] : fetchedMsgs);
        setMsgHasMore(data.has_more);
        setMsgPageToken(data.next_page_token || '');
        
        // Automatically mark as read if there are unread messages
        if (!loadMore && conv.unread_count > 0) {
          axios.post(`${API_URL}/conversations/read`, {
            conversation_ids: [conv.id]
          }).then(() => {
            fetchConversations();
            setSelectedConv(prev => prev?.id === conv.id ? { ...prev, unread_count: 0 } : prev);
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoadingMoreMsgs(false);
    }
  };

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(() => fetchConversations(), 30000);
    return () => clearInterval(interval);
  }, [convStatus]); // Refetch when filter changes

  useEffect(() => {
    if (selectedConv) {
      fetchMessages(selectedConv);
    }
  }, [selectedConv?.id]); // Re-fetch only when the ID changes

  useEffect(() => {
    if (!loadingMoreMsgs) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Check size < 10MB
    if (file.size > 10 * 1024 * 1024) {
      alert("Image must be smaller than 10MB");
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    
    setSending(true);
    try {
      const res = await axios.post(`${API_URL}/conversations/images/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.success) {
        setImageData(res.data.data); // Stores object: { url, width, height }
        const blobUrl = URL.createObjectURL(file);
        setSelectedImage(blobUrl); // Use local preview URL
        setLocalImageCache(prev => ({ ...prev, [res.data.data.url]: blobUrl }));
      } else {
        alert("Upload failed: " + res.data.error);
      }
    } catch (err) {
      alert("Upload failed");
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!selectedConv || sending) return;
    
    const isTextEmpty = !newMessage.trim();
    if (isTextEmpty && !imageData && !attachmentData.type) return;

    setSending(true);
    
    const payload: Record<string, any> = {};
    if (!isTextEmpty) payload.text = newMessage;
    if (imageData) payload.imageData = imageData;
    
    if (attachmentData.type === 'PRODUCT_CARD') payload.productId = attachmentData.id;
    if (attachmentData.type === 'TARGET_COLLABORATION_CARD') payload.collabId = attachmentData.id;
    if (attachmentData.type === 'FREE_SAMPLE_CARD') payload.applyId = attachmentData.id;

    try {
      const res = await axios.post(`${API_URL}/conversations/${selectedConv.id}/messages`, payload);

      if (res.data.success) {
        setNewMessage('');
        setImageData(null);
        setSelectedImage(null);
        setAttachmentData({ type: null, id: '' });
        setShowAttachments(false);
        fetchMessages(selectedConv);
      }
    } catch (err) {
      alert('Failed to send message: ' + (err.response?.data?.error || err.message));
    } finally {
      setSending(false);
    }
  };


  const filteredConversations = conversations.filter(conv => {
    if (!searchTerm) return true;
    const name = conv.username || '';
    return name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="main-content" style={{ paddingBottom: '2rem', overflow: 'hidden' }}>
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Messages</h1>
      </div>

      <div className="glass-card" style={{ display: 'flex', padding: 0, overflow: 'hidden', flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: '350px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
            <div className="search-bar">
              <Search size={18} />
              <input 
                type="text" 
                placeholder="Search conversations..." 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              {['ALL', 'UNREAD', 'UNREPLY'].map(status => (
                <button
                  key={status}
                  onClick={() => setConvStatus(status)}
                  style={{
                    padding: '0.25rem 0.75rem',
                    borderRadius: '1rem',
                    border: '1px solid var(--border-color)',
                    background: convStatus === status ? 'var(--accent)' : 'transparent',
                    color: 'white',
                    fontSize: '0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  {status === 'UNREPLY' ? 'Unreplied' : status.charAt(0) + status.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            ) : filteredConversations.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No conversations found.</div>
            ) : (
              <>
                {filteredConversations.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConv(conv)}
                    style={{
                      padding: '1.25rem 1.5rem',
                      cursor: 'pointer',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                      transition: 'all 0.2s',
                      display: 'flex',
                      gap: '1rem',
                      alignItems: 'center'
                    }}
                    className={`conv-item ${selectedConv?.id === conv.id ? 'selected' : ''}`}
                  >
                    <div className="avatar" style={{ width: '48px', height: '48px' }}>
                      {conv.avatar ? (
                        <img src={conv.avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        (conv.username || 'C').charAt(0)
                      )}
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{conv.username || 'Creator'}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {conv.latest_message?.create_time ? new Date(conv.latest_message.create_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(() => {
                          const content = conv.latest_message?.content;
                          if (!content) return conv.unread_count > 0 ? 'New message' : 'Conversation active';
                          try {
                            const parsed = typeof content === 'string' ? JSON.parse(content) : content;
                            if (conv.latest_message.type === 'IMAGE' || conv.latest_message.msg_type === 'IMAGE') return '📷 Image';
                            if (conv.latest_message.type === 'PRODUCT_CARD' || conv.latest_message.msg_type === 'PRODUCT_CARD') return '🛍️ Product Card';
                            if (conv.latest_message.type === 'TARGET_COLLABORATION_CARD' || conv.latest_message.msg_type === 'TARGET_COLLABORATION_CARD') return '🤝 Collaboration Card';
                            if (conv.latest_message.type === 'FREE_SAMPLE_CARD' || conv.latest_message.msg_type === 'FREE_SAMPLE_CARD') return '🎁 Sample Card';
                            return parsed.content || parsed.text || 'Message';
                          } catch (e) {
                            return content;
                          }
                        })()}
                      </div>
                    </div>
                    {conv.unread_count > 0 && (
                      <div style={{ background: 'var(--accent)', color: 'white', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>
                        {conv.unread_count}
                      </div>
                    )}
                  </div>
                ))}
                
                {convHasMore && !searchTerm && (
                  <div style={{ padding: '1rem', textAlign: 'center' }}>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => fetchConversations(true)}
                      disabled={loadingMoreConvs}
                      style={{ fontSize: '0.75rem' }}
                    >
                      {loadingMoreConvs ? 'Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(15, 23, 42, 0.3)', position: 'relative' }}>
          {selectedConv ? (
            <>
              <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-bg)', zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div className="avatar" style={{ width: '32px', height: '32px', fontSize: '0.875rem' }}>
                    {selectedConv.avatar ? (
                      <img src={selectedConv.avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      (selectedConv.username || 'C').charAt(0)
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{selectedConv.username || 'Creator'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--success)' }}>Online</div>
                  </div>
                </div>
                <button className="btn btn-secondary" style={{ padding: '0.5rem' }}>
                  <MoreVertical size={18} />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {msgHasMore && (
                  <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => fetchMessages(selectedConv, true)}
                      disabled={loadingMoreMsgs}
                      style={{ fontSize: '0.75rem' }}
                    >
                      {loadingMoreMsgs ? 'Loading...' : 'Load Previous Messages'}
                    </button>
                  </div>
                )}
                
                {messages?.map((item, i) => {
                  const msg = item.message_body || item; // Support both structures
                  // Identify if the message is from the seller
                  const isMe = msg.sender_id !== selectedConv.creator_im_id;
                  return (
                    <div key={msg.id || i} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '70%' }}>
                      <div
                        className={`msg-bubble ${isMe ? 'msg-bubble-me' : ''}`}
                        style={{
                          padding: '0.75rem 1rem',
                          borderRadius: isMe ? '1.25rem 1.25rem 0.25rem 1.25rem' : '1.25rem 1.25rem 1.25rem 0.25rem',
                          background: isMe ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
                          color: 'white',
                          fontSize: '0.9375rem',
                          lineHeight: '1.5',
                          position: 'relative',
                          border: isMe ? 'none' : '1px solid rgba(255, 255, 255, 0.05)'
                        }}
                      >
                        {(() => {
                          try {
                            const parsed = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
                            const msgType = msg.type || msg.msg_type;
                            if (msgType === 'IMAGE') {
                              const imgUrl = parsed.url || parsed.image_url;
                              return <img src={localImageCache[imgUrl] || imgUrl} alt="Image" style={{ maxWidth: '100%', borderRadius: '0.5rem' }} />;
                            }
                            if (msgType === 'PRODUCT_CARD') {
                              return <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Package size={16}/> Product ID: {parsed.product_id || parsed.productId}</div>;
                            }
                            if (msgType === 'TARGET_COLLABORATION_CARD') {
                              return <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={16}/> Collab ID: {parsed.target_collaboration_id}</div>;
                            }
                            if (msgType === 'FREE_SAMPLE_CARD') {
                              return <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Gift size={16}/> Sample Request: {parsed.apply_id}</div>;
                            }
                            return parsed.content || parsed.text || JSON.stringify(parsed);
                          } catch (e) {
                            return msg.content;
                          }
                        })()}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', textAlign: isMe ? 'right' : 'left', display: 'flex', alignItems: 'center', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: '0.25rem' }}>
                        {new Date(msg.create_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {isMe && <CheckCheck size={14} color={msg.is_read ? 'var(--success)' : 'var(--text-muted)'} />}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div style={{ padding: '1rem 1.5rem', background: 'var(--panel-bg)', borderTop: '1px solid var(--border-color)', position: 'relative' }}>
                
                {/* Previews */}
                {(imageData || attachmentData.type) && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                    {selectedImage && (
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <img src={selectedImage} alt="preview" style={{ height: '60px', borderRadius: '0.5rem', border: '1px solid var(--border-color)', objectFit: 'cover' }} />
                        <button 
                          onClick={() => { setImageData(null); setSelectedImage(null); }}
                          style={{ position: 'absolute', top: '-5px', right: '-5px', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', fontSize: '10px' }}
                        >✕</button>
                      </div>
                    )}
                    {attachmentData.type && (
                      <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.5rem 1rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--border-color)' }}>
                        {attachmentData.type === 'PRODUCT_CARD' && <Package size={16}/>}
                        {attachmentData.type === 'TARGET_COLLABORATION_CARD' && <FileText size={16}/>}
                        {attachmentData.type === 'FREE_SAMPLE_CARD' && <Gift size={16}/>}
                        <span style={{ fontSize: '0.875rem' }}>ID: {attachmentData.id}</span>
                        <button 
                          onClick={() => setAttachmentData({ type: null, id: '' })}
                          style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', marginLeft: '0.5rem' }}
                        >✕</button>
                      </div>
                    )}
                  </div>
                )}

                <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  
                  {/* Attachment Dropdown Toggle */}
                  <div style={{ position: 'relative' }}>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.75rem' }} onClick={() => setShowAttachments(!showAttachments)}>
                      <Paperclip size={20} />
                    </button>
                    
                    {showAttachments && (
                      <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: '0.5rem', background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', overflow: 'hidden', minWidth: '200px', zIndex: 20 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}>
                          <ImageIcon size={16} /> Image
                          <input type="file" accept="image/png, image/jpeg, image/gif, image/webp" style={{ display: 'none' }} onChange={handleImageUpload} />
                        </label>
                        <div 
                          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                          onClick={() => { const id = prompt("Enter Product ID:"); if(id) setAttachmentData({ type: 'PRODUCT_CARD', id }); setShowAttachments(false); }}
                        >
                          <Package size={16} /> Product Card
                        </div>
                        <div 
                          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                          onClick={() => { const id = prompt("Enter Target Collaboration ID:"); if(id) setAttachmentData({ type: 'TARGET_COLLABORATION_CARD', id }); setShowAttachments(false); }}
                        >
                          <FileText size={16} /> Collaboration Card
                        </div>
                        <div 
                          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', cursor: 'pointer' }}
                          onClick={() => { const id = prompt("Enter Apply ID for Sample:"); if(id) setAttachmentData({ type: 'FREE_SAMPLE_CARD', id }); setShowAttachments(false); }}
                        >
                          <Gift size={16} /> Sample Card
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Type a message..."
                      value={newMessage}
                      onChange={e => setNewMessage(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(0, 0, 0, 0.2)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '0.75rem',
                        padding: '0.75rem 1rem',
                        color: 'white',
                        outline: 'none'
                      }}
                    />
                  </div>
                  
                  <button type="submit" className="btn btn-primary" disabled={(!newMessage.trim() && !imageData && !attachmentData.type) || sending} style={{ padding: '0.75rem 1.5rem', minWidth: '60px', display: 'flex', justifyContent: 'center' }}>
                    {sending ? <Loader2 size={20} className="spinner" /> : <Send size={20} />}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <MessageSquare size={64} style={{ marginBottom: '1rem', opacity: 0.2 }} />
              <p>Select a conversation to start messaging</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
