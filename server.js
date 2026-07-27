const express = require('express');
const mineflayer = require('mineflayer');
const { pathfinder, movements, goals } = require('mineflayer-pathfinder');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ==========================================
// CONFIGURATION & GLOBAL STATE
// ==========================================
const CONFIG = {
  host: process.env.MC_HOST || 'KnightNW.com',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.MC_USERNAME || 'mistikhanim',
  version: false
};

let bot = null;
let antiAfkInterval = null;

const botState = {
  status: 'Başlatılıyor...',
  health: 20,
  food: 20,
  position: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
  selectedSlot: 0,
  activeModule: 'Boşta',
  inventory: [],
  nearbyPlayers: [],
  chatHistory: [],
  logs: []
};

// System Logging
function addLog(msg) {
  const time = new Date().toLocaleTimeString('tr-TR');
  const entry = `[${time}] ${msg}`;
  console.log(entry);
  botState.logs.unshift(entry);
  if (botState.logs.length > 80) botState.logs.pop();
}

function addChat(sender, message) {
  const time = new Date().toLocaleTimeString('tr-TR');
  botState.chatHistory.unshift({ time, sender, message });
  if (botState.chatHistory.length > 50) botState.chatHistory.pop();
}

// ==========================================
// MINEFLAYER BOT CREATION & EVENTS
// ==========================================
function createBot() {
  addLog('Bot sunucuya bağlanıyor...');
  
  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version
  });

  bot.loadPlugin(pathfinder);

  bot.on('spawn', () => {
    addLog('Bot başarıyla oyuna doğdu!');
    botState.status = 'Çevrimiçi';
    
    if (bot.pathfinder) {
      const defaultMove = new movements(bot);
      bot.pathfinder.setMovements(defaultMove);
    }
    updateInventory();
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    addChat(username, message);
  });

  bot.on('messagestr', (message) => {
    if (!message) return;
    // Sistem veya sunucu mesajlarını yakalar
    if (!message.includes(': ')) {
      addChat('SYSTEM', message);
    }
  });

  bot.on('health', () => {
    botState.health = Math.round(bot.health);
    botState.food = Math.round(bot.food);
    
    // Otomatik Yemek Yeme Mantığı
    if (bot.food < 15) {
      const foodItem = bot.inventory.items().find(i => 
        i.name.includes('cooked') || i.name.includes('apple') || 
        i.name.includes('bread') || i.name.includes('steak') || i.name.includes('porkchop')
      );
      if (foodItem) {
        bot.equip(foodItem, 'hand')
          .then(() => bot.consume())
          .catch(err => addLog(`Yemek yeme hatası: ${err.message}`));
      }
    }
  });

  bot.on('move', () => {
    if (!bot.entity) return;
    botState.position = {
      x: Math.floor(bot.entity.position.x),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z),
      yaw: bot.entity.yaw,
      pitch: bot.entity.pitch
    };
    updateNearbyPlayers();
  });

  bot.on('playerJoined', (player) => {
    addLog(`Sunucuya katıldı: ${player.username}`);
  });

  bot.on('playerLeft', (player) => {
    addLog(`Sunucudan ayrıldı: ${player.username}`);
  });

  bot.on('heldItemChanged', () => {
    botState.selectedSlot = bot.quickBarSlot;
    updateInventory();
  });

  bot.on('kicked', (reason) => {
    addLog(`Bot sunucudan atıldı: ${reason}`);
    botState.status = 'Atıldı';
  });

  bot.on('error', (err) => {
    addLog(`Hata oluştu: ${err.message}`);
  });

  bot.on('end', () => {
    addLog('Bağlantı koptu. 10 saniye sonra yeniden bağlanacak...');
    botState.status = 'Çevrimdışı';
    if (antiAfkInterval) clearInterval(antiAfkInterval);
    setTimeout(createBot, 10000);
  });
}

// Yardımcı Güncelleme Fonksiyonları
function updateInventory() {
  if (!bot || !bot.inventory) return;
  botState.inventory = bot.inventory.items().map(item => ({
    slot: item.slot,
    name: item.name,
    displayName: item.displayName,
    count: item.count
  }));
}

function updateNearbyPlayers() {
  if (!bot || !bot.entities) return;
  const players = [];
  
  for (const id in bot.entities) {
    const entity = bot.entities[id];
    if (entity.type === 'player' && entity.username && entity.username !== bot.username) {
      const dist = Math.floor(bot.entity.position.distanceTo(entity.position));
      players.push({
        id: entity.id,
        username: entity.username,
        x: Math.floor(entity.position.x),
        y: Math.floor(entity.position.y),
        z: Math.floor(entity.position.z),
        distance: dist,
        // Skin Kafası için mc-heads CDN adresi
        skinUrl: `https://mc-heads.net/avatar/${entity.username}/64`
      });
    }
  }
  botState.nearbyPlayers = players.sort((a, b) => a.distance - b.distance);
}

// Botu başlat
createBot();

// ==========================================
// REST API ENDPOINTS
// ==========================================

// Render & UptimeRobot Healthcheck
app.get('/health', (req, res) => res.status(200).send('OK'));

// Canlı Durum API
app.get('/api/status', (req, res) => {
  res.json(botState);
});

// Sol Tık (Vur / Kır / Swing) & Sağ Tık (Kullan / Etkileşim)
app.post('/api/click', (req, res) => {
  const { type } = req.body;
  if (!bot || !bot.entity) {
    return res.status(400).json({ success: false, message: 'Bot oyunda değil!' });
  }

  try {
    if (type === 'left') {
      // Sol tık: El sallar ve bakılan varlığa/bloğa vurur
      bot.swing('right');
      const targetEntity = bot.entityAtCursor(4);
      if (targetEntity) {
        bot.attack(targetEntity);
        addLog(`Sol Tık: ${targetEntity.username || targetEntity.name} varlığına vuruldu.`);
      } else {
        addLog('Sol Tık: Havaya/boşluğa vuruldu.');
      }
    } else if (type === 'right') {
      // Sağ tık: Eldeki eşyayı veya bakılan bloğu kullanır
      const targetBlock = bot.blockAtCursor(4);
      if (targetBlock) {
        bot.activateBlock(targetBlock);
        addLog(`Sağ Tık: ${targetBlock.name} bloğu ile etkileşime girildi.`);
      } else {
        bot.activateItem();
        addLog('Sağ Tık: Eldeki eşya kullanıldı.');
      }
    }
    res.json({ success: true, message: `${type.toUpperCase()} tık uygulandı.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Sohbet Mesajı ve Komut Gönderme
app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  if (!bot || !bot.entity) {
    return res.status(400).json({ success: false, message: 'Bot aktif değil!' });
  }
  
  bot.chat(message);
  addChat(bot.username, message);
  addLog(`Sohbet Gönderildi: ${message}`);
  res.json({ success: true });
});

// Hotbar Slot Değiştirme
app.post('/api/slot', (req, res) => {
  const { slot } = req.body;
  if (!bot || slot < 0 || slot > 8) {
    return res.status(400).json({ success: false, message: 'Geçersiz slot!' });
  }
  
  bot.setQuickBarSlot(slot);
  botState.selectedSlot = slot;
  addLog(`Hotbar slotu değiştirildi: ${slot + 1}`);
  res.json({ success: true });
});

// Oyuncu Takip Etme / Pathfinder
app.post('/api/follow', (req, res) => {
  const { username } = req.body;
  if (!bot || !bot.pathfinder) {
    return res.status(400).json({ success: false, message: 'Pathfinder aktif değil!' });
  }

  const target = bot.players[username]?.entity;
  if (!target) {
    return res.status(404).json({ success: false, message: 'Oyuncu yakında bulunamadı!' });
  }

  const goal = new goals.GoalFollow(target, 2);
  bot.pathfinder.setGoal(goal, true);
  botState.activeModule = `Takip Ediyor: ${username}`;
  addLog(`${username} oyuncusu takip ediliyor...`);
  res.json({ success: true });
});

// AFK Önleyici Modül
app.post('/api/anti-afk', (req, res) => {
  const { enable } = req.body;
  
  if (antiAfkInterval) clearInterval(antiAfkInterval);

  if (enable) {
    antiAfkInterval = setInterval(() => {
      if (bot && bot.entity) {
        const randomYaw = (Math.random() * 360 - 180) * (Math.PI / 180);
        bot.look(randomYaw, 0, true);
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 300);
      }
    }, 10000);
    botState.activeModule = 'Anti-AFK Aktif';
    addLog('Anti-AFK modu başlatıldı.');
  } else {
    botState.activeModule = 'Boşta';
    if (bot && bot.pathfinder) bot.pathfinder.stop();
    addLog('Tüm modüller ve Anti-AFK durduruldu.');
  }

  res.json({ success: true, activeModule: botState.activeModule });
});

// ==========================================
// FULL HTML & CANVAS WEB DASHBOARD
// ==========================================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Minecraft Pro Ultimate Dashboard</title>
    <style>
        :root {
            --bg-dark: #0f0f12;
            --card-bg: #18181c;
            --accent: #7289da;
            --accent-hover: #5b6eae;
            --green: #43b581;
            --red: #f04747;
            --border: #28282e;
            --text-main: #dcddde;
            --text-muted: #8e9297;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: var(--bg-dark); color: var(--text-main); padding: 20px; }

        .header { display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 20px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 20px; }
        .header h1 { font-size: 1.5rem; color: #fff; display: flex; align-items: center; gap: 10px; }
        .bot-badge { padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; text-transform: uppercase; }
        .badge-online { background: rgba(67, 181, 129, 0.2); color: var(--green); border: 1px solid var(--green); }
        .badge-offline { background: rgba(240, 71, 71, 0.2); color: var(--red); border: 1px solid var(--red); }

        .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .card { background: var(--card-bg); padding: 20px; border-radius: 12px; border: 1px solid var(--border); }
        .card h2 { font-size: 1.1rem; color: #fff; margin-bottom: 15px; border-bottom: 1px solid var(--border); padding-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }

        /* Status Stats */
        .stat-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
        .stat-box { background: #111114; padding: 12px; border-radius: 8px; border: 1px solid var(--border); }
        .stat-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
        .stat-value { font-size: 1.2rem; font-weight: bold; margin-top: 4px; color: #fff; }

        /* Controls & Action Buttons */
        .action-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
        button { background: var(--accent); color: white; border: none; padding: 12px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        button:hover { background: var(--accent-hover); transform: translateY(-1px); }
        button.btn-red { background: var(--red); }
        button.btn-red:hover { background: #d83a3a; }
        button.btn-green { background: var(--green); }
        button.btn-green:hover { background: #3ca374; }

        /* Click Controls */
        .click-controls { display: flex; gap: 10px; background: #111114; padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 15px; }
        .btn-left-click { background: #e67e22; flex: 1; }
        .btn-left-click:hover { background: #d35400; }
        .btn-right-click { background: #2980b9; flex: 1; }
        .btn-right-click:hover { background: #1f618d; }

        /* Hotbar Slots */
        .hotbar-container { display: flex; gap: 6px; justify-content: space-between; background: #111114; padding: 10px; border-radius: 8px; border: 1px solid var(--border); }
        .hotbar-slot { width: 38px; height: 38px; background: #202026; border: 2px solid var(--border); border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.8rem; font-weight: bold; color: var(--text-muted); transition: 0.2s; }
        .hotbar-slot.active { border-color: var(--accent); background: rgba(114, 137, 218, 0.2); color: #fff; }

        /* Player List & Skins */
        .player-list { max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .player-card { display: flex; align-items: center; justify-content: space-between; background: #111114; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); }
        .player-info { display: flex; align-items: center; gap: 12px; }
        .player-skin { width: 36px; height: 36px; border-radius: 6px; border: 1px solid var(--border); background: #202026; }
        .player-name { font-weight: 600; font-size: 0.95rem; }
        .player-coords { font-size: 0.75rem; color: var(--text-muted); }

        /* 2D Radar Canvas */
        .radar-box { display: flex; justify-content: center; align-items: center; background: #0b0b0d; border-radius: 8px; border: 1px solid var(--border); padding: 10px; }
        canvas { background: #111114; border-radius: 6px; }

        /* Chat & Logs */
        .chat-box { height: 200px; overflow-y: auto; background: #0b0b0d; padding: 12px; border-radius: 8px; border: 1px solid var(--border); font-size: 0.85rem; margin-bottom: 10px; display: flex; flex-direction: column-reverse; }
        .chat-entry { margin-bottom: 6px; }
        .chat-sender { font-weight: bold; color: var(--accent); }
        .chat-input-group { display: flex; gap: 8px; }
        input[type="text"] { flex: 1; background: #111114; border: 1px solid var(--border); padding: 10px 14px; border-radius: 8px; color: #fff; font-size: 0.9rem; outline: none; }
        input[type="text"]:focus { border-color: var(--accent); }

        .logs-box { height: 160px; overflow-y: auto; background: #0b0b0d; padding: 10px; border-radius: 8px; border: 1px solid var(--border); font-family: monospace; font-size: 0.8rem; color: var(--text-muted); }
        .log-line { margin-bottom: 4px; }
    </style>
</head>
<body>

    <div class="header">
        <h1>🎮 Minecraft Pro Bot Panel</h1>
        <span id="badge-status" class="bot-badge badge-offline">Yükleniyor...</span>
    </div>

    <div class="dashboard-grid">
        <!-- SOL PANEL: Bot Durumu ve Aksiyonlar -->
        <div class="card">
            <h2>📊 Bot Durumu & Aksiyonlar</h2>
            
            <div class="stat-group">
                <div class="stat-box">
                    <div class="stat-label">❤️ Can</div>
                    <div id="stat-health" class="stat-value">20 / 20</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">🍗 Açlık</div>
                    <div id="stat-food" class="stat-value">20 / 20</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">📍 Konum (XYZ)</div>
                    <div id="stat-pos" class="stat-value">0, 0, 0</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">⚙️ Aktif Modül</div>
                    <div id="stat-module" class="stat-value">Boşta</div>
                </div>
            </div>

            <h3 style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase;">🖱️ Siteden Tıklama Kontrolü</h3>
            <div class="click-controls">
                <button class="btn-left-click" onclick="sendClick('left')">⚔️ Sol Tık (Vur/Kır)</button>
                <button class="btn-right-click" onclick="sendClick('right')">🛡️ Sağ Tık (Kullan)</button>
            </div>

            <h3 style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase;">🎒 Hotbar Seçimi</h3>
            <div class="hotbar-container" id="hotbar-slots">
                <!-- Javascript dinamik olarak 1-9 slot çizecek -->
            </div>

            <div style="margin-top: 15px;" class="action-buttons">
                <button class="btn-green" onclick="toggleAntiAfk(true)">🔄 Anti-AFK Başlat</button>
                <button class="btn-red" onclick="toggleAntiAfk(false)">🛑 Modülü Durdur</button>
            </div>
        </div>

        <!-- ORTA PANEL: 2D Radar & Yakındaki Oyuncular (Skinli) -->
        <div class="card">
            <h2>👥 Yakındaki Oyuncular & Radar</h2>
            
            <div class="radar-box" style="margin-bottom: 15px;">
                <canvas id="radarCanvas" width="220" height="220"></canvas>
            </div>

            <div class="player-list" id="player-container">
                <!-- Skinli oyuncular buraya yüklenecek -->
            </div>
        </div>

        <!-- SAĞ PANEL: Canlı Sohbet & Konsol Logları -->
        <div class="card">
            <h2>💬 Canlı Oyun İçi Sohbet</h2>
            <div class="chat-box" id="chat-container"></div>
            <div class="chat-input-group">
                <input type="text" id="chat-input" placeholder="Mesaj veya /komut yazın..." onkeydown="if(event.key==='Enter') sendChatMessage()">
                <button onclick="sendChatMessage()">Gönder</button>
            </div>

            <h2 style="margin-top: 20px;">📋 Sistem Logları</h2>
            <div class="logs-box" id="logs-container"></div>
        </div>
    </div>

    <script>
        let currentSelectedSlot = 0;
        const playerSkinsCache = {};

        // Hotbar Butonlarını Oluştur
        const hotbarElem = document.getElementById('hotbar-slots');
        for (let i = 0; i < 9; i++) {
            const slotBtn = document.createElement('div');
            slotBtn.className = \`hotbar-slot \${i === 0 ? 'active' : ''}\`;
            slotBtn.innerText = i + 1;
            slotBtn.onclick = () => selectSlot(i);
            slotBtn.id = \`slot-\${i}\`;
            hotbarElem.appendChild(slotBtn);
        }

        async function fetchDashboardData() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();

                // Status Badge
                const badge = document.getElementById('badge-status');
                badge.innerText = data.status;
                badge.className = \`bot-badge \${data.status === 'Çevrimiçi' ? 'badge-online' : 'badge-offline'}\`;

                // Stats
                document.getElementById('stat-health').innerText = \`\${data.health} / 20\`;
                document.getElementById('stat-food').innerText = \`\${data.food} / 20\`;
                document.getElementById('stat-pos').innerText = \`\${data.position.x}, \${data.position.y}, \${data.position.z}\`;
                document.getElementById('stat-module').innerText = data.activeModule;

                // Slot Selection Update
                if (currentSelectedSlot !== data.selectedSlot) {
                    document.querySelectorAll('.hotbar-slot').forEach(el => el.classList.remove('active'));
                    const activeSlot = document.getElementById(\`slot-\${data.selectedSlot}\`);
                    if (activeSlot) activeSlot.classList.add('active');
                    currentSelectedSlot = data.selectedSlot;
                }

                // Render Player Skins
                renderPlayerList(data.nearbyPlayers);

                // Render 2D Radar
                drawRadar(data.position, data.nearbyPlayers);

                // Render Chat & Logs
                renderChat(data.chatHistory);
                renderLogs(data.logs);

            } catch (err) {
                console.error("Veri çekme hatası:", err);
            }
        }

        function renderPlayerList(players) {
            const container = document.getElementById('player-container');
            if (!players || players.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Yakında hiç oyuncu yok.</div>';
                return;
            }

            container.innerHTML = players.map(p => \`
                <div class="player-card">
                    <div class="player-info">
                        <img src="\${p.skinUrl}" class="player-skin" alt="\${p.username}" onerror="this.src='https://mc-heads.net/avatar/MHF_Steve/64'">
                        <div>
                            <div class="player-name">\${p.username}</div>
                            <div class="player-coords">Mesafe: \${p.distance}m (\${p.x}, \${p.y}, \${p.z})</div>
                        </div>
                    </div>
                    <button style="padding: 6px 12px; font-size: 0.75rem;" onclick="followPlayer('\${p.username}')">Takip Et</button>
                </div>
            \`).join('');
        }

        function drawRadar(botPos, players) {
            const canvas = document.getElementById('radarCanvas');
            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const center = width / 2;
            const scale = 3; // 1 blok = 3 piksel

            ctx.clearRect(0, 0, width, height);

            // Izgara Çizimi
            ctx.strokeStyle = '#202026';
            ctx.lineWidth = 1;
            for (let x = 0; x < width; x += 20) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
            }
            for (let y = 0; y < height; y += 20) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
            }

            // Botun Kendi Konumu (Merkez - Yeşil Nokta)
            ctx.fillStyle = '#43b581';
            ctx.beginPath();
            ctx.arc(center, center, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();

            // Yakındaki Oyuncuları Radara Çiz (Skin Kafaları ile)
            players.forEach(p => {
                const relX = (p.x - botPos.x) * scale;
                const relZ = (p.z - botPos.z) * scale;

                const posX = center + relX;
                const posY = center + relZ;

                // Görüş alanı dışındakileri sınırla
                if (posX >= 10 && posX <= width - 10 && posY >= 10 && posY <= height - 10) {
                    if (!playerSkinsCache[p.username]) {
                        const img = new Image();
                        img.src = p.skinUrl;
                        img.onload = () => { playerSkinsCache[p.username] = img; };
                    }

                    if (playerSkinsCache[p.username]) {
                        ctx.drawImage(playerSkinsCache[p.username], posX - 8, posY - 8, 16, 16);
                    } else {
                        ctx.fillStyle = '#f04747';
                        ctx.beginPath();
                        ctx.arc(posX, posY, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    // Oyuncu Adı Yazısı
                    ctx.fillStyle = '#ffffff';
                    ctx.font = '9px sans-serif';
                    ctx.fillText(p.username, posX - 15, posY - 10);
                }
            });
        }

        function renderChat(chat) {
            const container = document.getElementById('chat-container');
            container.innerHTML = chat.map(c => \`
                <div class="chat-entry">
                    <span style="color: var(--text-muted); font-size: 0.75rem;">[\${c.time}]</span> 
                    <span class="chat-sender">\${c.sender}:</span> 
                    <span>\${c.message}</span>
                </div>
            \`).join('');
        }

        function renderLogs(logs) {
            const container = document.getElementById('logs-container');
            container.innerHTML = logs.map(l => \`<div class="log-line">\${l}</div>\`).join('');
        }

        // POST Aksiyonları
        async function sendClick(type) {
            await fetch('/api/click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            fetchDashboardData();
        }

        async function selectSlot(slot) {
            await fetch('/api/slot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot })
            });
            fetchDashboardData();
        }

        async function followPlayer(username) {
            await fetch('/api/follow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            fetchDashboardData();
        }

        async function toggleAntiAfk(enable) {
            await fetch('/api/anti-afk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enable })
            });
            fetchDashboardData();
        }

        async function sendChatMessage() {
            const input = document.getElementById('chat-input');
            const message = input.value.trim();
            if (!message) return;

            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });

            input.value = '';
            fetchDashboardData();
        }

        // 2 saniyede bir otomatik verileri tazele
        setInterval(fetchDashboardData, 2000);
        fetchDashboardData();
    </script>
</body>
</html>
  `);
});

// ==========================================
// SERVER START
// ==========================================
app.listen(PORT, () => {
  addLog(`Gelişmiş Web Dashboard ${PORT} portunda başarıyla başlatıldı!`);
});
const express = require('express');
const mineflayer = require('mineflayer');
const { pathfinder, movements, goals } = require('mineflayer-pathfinder');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ==========================================
// CONFIGURATION & GLOBAL STATE
// ==========================================
const CONFIG = {
  host: process.env.MC_HOST || 'KnightNW.com',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.MC_USERNAME || 'mistikhanim',
  version: false
};

let bot = null;
let farmerInterval = null;
let antiAfkInterval = null;

const botState = {
  status: 'Başlatılıyor...',
  health: 20,
  food: 20,
  position: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
  selectedSlot: 0,
  activeModule: 'Otomatik Çiftçi Aktif',
  inventory: [],
  nearbyPlayers: [],
  chatHistory: [],
  logs: []
};

// System Logging
function addLog(msg) {
  const time = new Date().toLocaleTimeString('tr-TR');
  const entry = `[${time}] ${msg}`;
  console.log(entry);
  botState.logs.unshift(entry);
  if (botState.logs.length > 80) botState.logs.pop();
}

function addChat(sender, message) {
  const time = new Date().toLocaleTimeString('tr-TR');
  botState.chatHistory.unshift({ time, sender, message });
  if (botState.chatHistory.length > 50) botState.chatHistory.pop();
}
