import { useState, useEffect, useRef } from 'react';
import { Search, Send, Image as ImageIcon, MoreVertical, CheckCheck, MessageSquare } from 'lucide-react';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

export default function MessagesPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  const fetchConversations = async () => {
    try {
      const res = await axios.get(`${API_URL}/conversations`);
      if (res.data.success) {
        const convs = res.data.data.conversations || [];
        setConversations(convs);
        
        // Fetch latest unread messages to augment the snippets
        const unreadRes = await axios.get(`${API_URL}/conversations/unread`);
        if (unreadRes.data.success && unreadRes.data.data.newest_message_list) {
           const unreadMap = {};
           unreadRes.data.data.newest_message_list.forEach(msg => {
             unreadMap[msg.conversation_id] = msg;
           });
           setConversations(prev => prev.map(c => {
             if (unreadMap[c.id]) {
                return { ...c, latest_message: unreadMap[c.id] };
             }
             return c;
           }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (conv) => {
    try {
      const res = await axios.get(`${API_URL}/conversations/${conv.id}/messages`);
      if (res.data.success) {
        setMessages(res.data.data.messages || []);
        
        // Automatically mark as read if there are unread messages
        if (conv.unread_count > 0) {
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
    }
  };

  useEffect(() => {
    fetchConversations();
    // Poll for unread messages every 30 seconds
    const interval = setInterval(fetchConversations, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedConv) {
      fetchMessages(selectedConv);
    }
  }, [selectedConv]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConv || sending) return;

    setSending(true);
    try {
      const res = await axios.post(`${API_URL}/conversations/${selectedConv.id}/messages`, {
        text: newMessage
      });

      if (res.data.success) {
        setNewMessage('');
        fetchMessages(selectedConv);
      }
    } catch (err) {
      alert('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="main-content" style={{ paddingBottom: '2rem', overflow: 'hidden' }}>
      <div className="header">
        <h1>Messages</h1>
      </div>

      <div className="glass-card" style={{ display: 'flex', padding: 0, overflow: 'hidden', flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: '350px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
            <div className="search-bar">
              <Search size={18} />
              <input type="text" placeholder="Search conversations..." />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            ) : conversations?.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No conversations yet.</div>
            ) : (
              conversations?.map(conv => (
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
                          if (conv.latest_message.type === 'IMAGE') return '📷 Image';
                          if (conv.latest_message.type === 'PRODUCT_CARD') return '🛍️ Product Card';
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
              ))
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(15, 23, 42, 0.3)' }}>
          {selectedConv ? (
            <>
              <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-bg)' }}>
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
                {messages?.map((item, i) => {
                  const msg = item.message_body || item; // Support both structures
                  // Identify if the message is from the seller by checking if the sender is NOT the creator
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
                              return <img src={parsed.url || parsed.image_url} alt="Sent" style={{ maxWidth: '100%', borderRadius: '0.5rem' }} />;
                            }
                            if (msgType === 'PRODUCT_CARD') {
                              return <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '0.5rem' }}>🛍️ Product ID: {parsed.product_id || parsed.productId}</div>;
                            }
                            if (msgType === 'TARGET_COLLABORATION_CARD' || msgType === 'FREE_SAMPLE_CARD') {
                              return <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '0.5rem' }}>📋 Invitation/Sample Card</div>;
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

              <div style={{ padding: '1.5rem', background: 'var(--panel-bg)', borderTop: '1px solid var(--border-color)' }}>
                <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '1rem' }}>
                  <button type="button" className="btn btn-secondary" style={{ padding: '0.75rem' }}>
                    <ImageIcon size={20} />
                  </button>
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
                  <button type="submit" className="btn btn-primary" disabled={!newMessage.trim() || sending} style={{ padding: '0.75rem 1.5rem' }}>
                    <Send size={20} />
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
    </div>
  );
}
