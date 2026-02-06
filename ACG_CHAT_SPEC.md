# ACG GLOBAL CHAT BUILD SPEC

## MISSION
Build a decentralized "Teams-like" global chat for GitHub Pages.
Anyone can join. No server. Pure static HTML/JS with clever sync.

**ACG Principles Applied:**
- Transparency: All AI assistance clearly labeled
- User Agency: Users control their data, can export/delete anytime
- Quality: Tested, verified, no half-baked features
- Safety: No tracking, no cookies, privacy-first

---

## ARCHITECTURE

```
chat/
├── index.html           # Entry point
├── css/style.css        # UI (<250 tokens)
├── js/
│   ├── core/            # Core modules
│   │   ├── events.js    # Event bus
│   │   ├── state.js     # State management
│   │   └── crypto.js    # Message signing
│   ├── chat/            # Chat modules
│   │   ├── room.js      # Room (Cube-based)
│   │   ├── message.js   # Message format
│   │   ├── user.js      # User identity
│   │   └── thread.js    # Threaded replies
│   ├── sync/            # Sync modules
│   │   ├── local.js     # LocalStorage sync
│   │   ├── broadcast.js # BroadcastChannel
│   │   ├── poll.js      # GitHub raw file polling
│   │   └── rtc.js       # WebRTC P2P (optional)
│   ├── storage/         # Storage modules
│   │   ├── db.js        # IndexedDB
│   │   ├── export.js    # Export/import
│   │   └── chunks.js    # Chunked storage
│   └── ui/              # UI modules
│       ├── render.js    # DOM rendering
│       ├── input.js     # Message input
│       └── notify.js    # Notifications
└── data/
    ├── rooms/           # Room definitions
    └── messages/        # Message chunks
```

---

## CORE CONCEPTS

### Room = Cube
Each chat room is a Konomi Cube:
- 8 vertices = 8 topic channels per room
- 1 central = main room chat
- Connections = cross-channel references

```javascript
class Room extends Cube {
  static CHANNELS = {
    'NEU': 'general',
    'NED': 'random',
    'NWU': 'announcements',
    'NWD': 'questions',
    'SEU': 'ideas',
    'SED': 'feedback',
    'SWU': 'off-topic',
    'SWD': 'archive'
  };
}
```

### Message Format
```javascript
{
  id: 'uuid-v4',
  room: 'room-id',
  channel: 'NEU',           // vertex
  user: {
    id: 'user-uuid',
    name: 'Display Name',
    color: '#6366f1'        // user-chosen
  },
  content: 'Hello world',
  timestamp: 1706000000000,
  replyTo: null,            // thread parent
  reactions: {},            // {emoji: [userIds]}
  edited: false,
  aiAssisted: false,        // ACG transparency
  signature: 'base64...'    // optional verification
}
```

### User Identity (No Auth Required)
```javascript
{
  id: 'generated-uuid',
  name: 'Anonymous Craftsperson',
  color: '#random',
  publicKey: 'optional-for-signing',
  created: timestamp,
  rooms: ['room-ids']
}
```

---

## SYNC STRATEGIES

### 1. Same-Tab Broadcast (Instant)
```javascript
const bc = new BroadcastChannel('acg-chat');
bc.postMessage({ type: 'message', data: msg });
bc.onmessage = (e) => handleSync(e.data);
```

### 2. LocalStorage Events (Cross-Tab)
```javascript
window.addEventListener('storage', (e) => {
  if (e.key === 'acg-chat-sync') {
    handleSync(JSON.parse(e.newValue));
  }
});
```

### 3. GitHub Raw Polling (Cross-User)
Poll `data/messages/latest.json` every 30s:
```javascript
async function pollMessages() {
  const res = await fetch('data/messages/latest.json?' + Date.now());
  const msgs = await res.json();
  mergeMessages(msgs);
}
setInterval(pollMessages, 30000);
```

### 4. WebRTC P2P (Optional Real-Time)
Use signaling via GitHub Issues/Gists:
```javascript
// Post offer to GitHub Gist
// Other clients poll for offers
// Establish direct P2P connection
```

---

## DATA STORAGE

### IndexedDB Schema
```javascript
const stores = {
  users: { keyPath: 'id' },
  rooms: { keyPath: 'id' },
  messages: { keyPath: 'id', indexes: ['room', 'timestamp'] },
  sync: { keyPath: 'key' }
};
```

### GitHub Pages Static Files
```
data/
├── rooms/
│   ├── index.json        # Room list
│   └── {room-id}.json    # Room config
└── messages/
    ├── latest.json       # Last 100 messages
    └── archive/
        └── 2024-01-15.json  # Daily archives
```

---

## UI COMPONENTS

### Main Layout
```
┌─────────────────────────────────────────────────┐
│ ACG Chat ⚒                    [User] [Settings] │
├──────────┬──────────────────────────────────────┤
│ Rooms    │ #general                    [Search] │
│ ──────── │ ────────────────────────────────────│
│ > Room 1 │ @alice: Hello everyone!              │
│   Room 2 │ @bob: Hey! Working on the PR         │
│   Room 3 │ @carol: [AI] Summary of discussion...│
│          │                                      │
│ Channels │                                      │
│ ──────── │                                      │
│ #general │                                      │
│ #random  │                                      │
│ #ideas   │ ────────────────────────────────────│
│          │ [Type message...            ] [Send] │
└──────────┴──────────────────────────────────────┘
```

### ACG Transparency Markers
```css
.message.ai-assisted {
  border-left: 3px solid #f59e0b;
}
.message.ai-assisted::before {
  content: '🤖 AI-Assisted';
  font-size: 0.7em;
  color: #f59e0b;
}
```

---

## ACG COMPLIANCE CHECKLIST

### Quality ✓
- [ ] All features tested before deploy
- [ ] Graceful degradation (no JS = read-only)
- [ ] Error boundaries everywhere
- [ ] Rate limiting on sync

### Safety ✓
- [ ] No external tracking
- [ ] No cookies (localStorage only)
- [ ] Optional message signing
- [ ] Content moderation hooks

### Transparency ✓
- [ ] AI content clearly marked
- [ ] Open source (visible on GitHub)
- [ ] Data format documented
- [ ] Export everything anytime

### User Agency ✓
- [ ] Choose display name/color
- [ ] Delete own messages
- [ ] Export all data
- [ ] Leave rooms anytime
- [ ] Block users locally

---

## BUILD ORDER

1. **Core** (events.js, state.js)
2. **Storage** (db.js, chunks.js)
3. **User** (user.js, identity generation)
4. **Message** (message.js, formatting)
5. **Room** (room.js, Cube extension)
6. **Sync** (local.js, broadcast.js)
7. **UI** (render.js, input.js)
8. **Polish** (notify.js, export.js)
9. **Optional** (rtc.js, crypto.js)

---

## QUICK START CODE

```javascript
// Initialize
const chat = new ACGChat();
await chat.init();

// Create/join room
const room = chat.joinRoom('acg-main');

// Send message
room.send({
  channel: 'general',
  content: 'Hello ACG! ⚒',
  aiAssisted: false
});

// Listen for messages
room.on('message', (msg) => {
  renderMessage(msg);
});

// Export data (user agency)
const backup = await chat.exportAll();
downloadJSON(backup, 'acg-chat-backup.json');
```

---

## PERFORMANCE TARGETS

| Metric | Target |
|--------|--------|
| Initial load | <500ms |
| Message render | <16ms |
| Sync interval | 30s (polling) |
| Storage limit | 50MB IndexedDB |
| Message history | Last 10,000 |

---

## TESTING PLAN

1. **Unit**: Each module in isolation
2. **Integration**: Room + Message + Sync
3. **E2E**: Open 2 tabs, send message, verify sync
4. **Cross-browser**: Chrome, Firefox, Safari
5. **Offline**: Disconnect, queue messages, reconnect

---

## DEPLOYMENT

1. Push to GitHub repo
2. Enable GitHub Pages
3. Users visit `https://username.github.io/chat/`
4. No server needed ever

---

**ACG MOTTO**: Quality code, transparent AI, human-centered design. ⚒
