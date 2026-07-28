const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ================= CONFIGURATION =================
const CONFIG = {
  host: process.env.BOT_HOST || 'play.knightnw.com',
  port: parseInt(process.env.BOT_PORT) || 25565,
  username: process.env.BOT_USERNAME || 'mistikhanim',
  password: process.env.BOT_PASSWORD || 'salakmustafa',
  version: process.env.BOT_VERSION || '1.21.1', // 1.21+ sürümleri için
  reconnectDelay: 10000, // Koparsa 10s sonra tekrar dener
};

// ================= EXPRESS & SOCKET.IO =================
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

let bot = null;
let antiAfkInterval = null;

// Render / Railway Keep-Alive
app.get('/', (req, res) => {
  res.send(getDashboardHTML());
});

app.get('/ping', (req, res) => {
  res.status(200).send('OK - Bot Alive');
});

// ================= MINEFLAYER BOT CREATION =================
function createBot() {
  console.log(`[BOT] ${CONFIG.host} sunucusuna (${CONFIG.username}) bağlanılıyor...`);

  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version,
  });

  bot.once('spawn', () => {
    console.log('[BOT] Oyuna giriş yapıldı!');
    emitStatus('Bağlandı');

    // Otomatik Giriş ve Rota Komutları
    setTimeout(() => {
      bot.chat(`/login ${CONFIG.password}`);
      console.log('[BOT] /login komutu gönderildi.');
    }, 2000);

    setTimeout(() => {
      bot.chat('/skyblock');
      console.log('[BOT] /skyblock komutu gönderildi.');
    }, 5000);

    setTimeout(() => {
      bot.chat('/is go');
      console.log('[BOT] /is go komutu gönderildi.');
    }, 8000);

    // Anti-AFK Döngüsü (Zıplama & Bakış Değiştirme)
    startAntiAFK();
  });

  // Chat Dinleyici
  bot.on('chat', (username, message) => {
    io.emit('chat_message', { type: 'chat', sender: username, text: message });
  });

  bot.on('message', (jsonMsg) => {
    const rawText = jsonMsg.toString();
    if (rawText.trim()) {
      io.emit('chat_message', { type: 'system', text: rawText });
    }
  });

  // Can ve Açlık Güncellemesi
  bot.on('health', () => {
    io.emit('bot_stats', {
      health: bot.health,
      food: bot.food,
      pos: bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 }
    });
  });

  // Bağlantı Kopma & Hata Durumları
  bot.on('kicked', (reason) => {
    console.log('[BOT] Sunucudan atıldı:', reason);
    emitStatus('Atıldı: ' + JSON.stringify(reason));
    stopAntiAFK();
  });

  bot.on('error', (err) => {
    console.error('[BOT] Hata oluştu:', err.message);
    emitStatus('Hata: ' + err.message);
  });

  bot.on('end', () => {
    console.log(`[BOT] Bağlantı koptu. ${CONFIG.reconnectDelay / 1000} saniye sonra tekrar deneniyor...`);
    emitStatus('Bağlantı Koptu - Tekrar Deneniyor...');
    stopAntiAFK();
    setTimeout(createBot, CONFIG.reconnectDelay);
  });
}

// ================= HELPER FUNCTIONS =================
function startAntiAFK() {
  if (antiAfkInterval) clearInterval(antiAfkInterval);
  antiAfkInterval = setInterval(() => {
    if (bot && bot.entity) {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);

      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI;
      bot.look(yaw, pitch, true);
    }
  }, 15000);
}

function stopAntiAFK() {
  if (antiAfkInterval) clearInterval(antiAfkInterval);
}

function emitStatus(status) {
  io.emit('bot_status', { status });
}

// ================= SOCKET.IO CLIENT EVENTS =================
io.on('connection', (socket) => {
  console.log('[PANEL] Kullanıcı bağlandı.');

  if (bot && bot.entity) {
    socket.emit('bot_stats', {
      health: bot.health,
      food: bot.food,
      pos: bot.entity.position
    });
  }

  socket.on('send_command', (cmd) => {
    if (bot && cmd) {
      bot.chat(cmd);
      console.log(`[PANEL -> BOT] Komut atıldı: ${cmd}`);
    }
  });

  socket.on('force_reconnect', () => {
    if (bot) {
      bot.quit();
    } else {
      createBot();
    }
  });
});

// ================= DASHBOARD UI (HTML/CSS) =================
function getDashboardHTML() {
  return `
  <!DOCTYPE html>
  <html lang="tr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KnightNW AFK Manager - mistikhanim</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; }
      body { background: #121214; color: #e1e1e6; padding: 20px; display: flex; flex-direction: column; gap: 20px; height: 100vh; }
      header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #29292e; padding-bottom: 15px; }
      h1 { font-size: 1.4rem; color: #00b37e; }
      .status-badge { background: #202024; padding: 6px 12px; border-radius: 6px; font-weight: bold; border: 1px solid #323238; }
      .grid { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; flex: 1; min-height: 0; }
      .card { background: #202024; border: 1px solid #323238; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 10px; }
      .stat-row { display: flex; justify-content: space-between; background: #121214; padding: 10px; border-radius: 6px; }
      #chat-box { flex: 1; background: #121214; border-radius: 6px; padding: 10px; overflow-y: auto; font-family: monospace; font-size: 0.9rem; border: 1px solid #323238; }
      .chat-line { margin-bottom: 4px; word-break: break-word; }
      .chat-system { color: #8d8d99; }
      .chat-user { color: #50a14f; font-weight: bold; }
      .input-group { display: flex; gap: 10px; }
      input { flex: 1; background: #121214; border: 1px solid #323238; color: #fff; padding: 10px; border-radius: 6px; outline: none; }
      button { background: #00b37e; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; }
      button:hover { background: #00875f; }
      .btn-danger { background: #f75a68; }
      .btn-danger:hover { background: #ce404d; }
    </style>
  </head>
  <body>
    <header>
      <h1>KnightNW AFK Manager (mistikhanim)</h1>
      <div class="status-badge" id="status">Bağlanıyor...</div>
    </header>

    <div class="grid">
      <div class="card">
        <h3>Bot Durumu</h3>
        <div class="stat-row"><span>Can:</span><strong id="health">20 / 20</strong></div>
        <div class="stat-row"><span>Açlık:</span><strong id="food">20 / 20</strong></div>
        <div class="stat-row"><span>Konum (XYZ):</span><strong id="pos">0, 0, 0</strong></div>
        <button class="btn-danger" onclick="reconnect()">Yeniden Bağlan</button>
      </div>

      <div class="card">
        <h3>Canlı Oyun Chat & Konsol</h3>
        <div id="chat-box"></div>
        <div class="input-group">
          <input type="text" id="cmd-input" placeholder="Komut veya mesaj yazın..." onkeydown="if(event.key==='Enter') sendCmd()">
          <button onclick="sendCmd()">Gönder</button>
        </div>
      </div>
    </div>

    <script>
      const socket = io();

      socket.on('bot_status', data => {
        document.getElementById('status').innerText = data.status;
      });

      socket.on('bot_stats', data => {
        if(data.health !== undefined) document.getElementById('health').innerText = Math.round(data.health) + ' / 20';
        if(data.food !== undefined) document.getElementById('food').innerText = Math.round(data.food) + ' / 20';
        if(data.pos) {
          document.getElementById('pos').innerText = \`\${Math.round(data.pos.x)}, \${Math.round(data.pos.y)}, \${Math.round(data.pos.z)}\`;
        }
      });

      socket.on('chat_message', msg => {
        const box = document.getElementById('chat-box');
        const line = document.createElement('div');
        line.className = 'chat-line ' + (msg.type === 'system' ? 'chat-system' : '');
        line.innerText = msg.sender ? \`[\${msg.sender}] \${msg.text}\` : msg.text;
        box.appendChild(line);
        box.scrollTop = box.scrollHeight;
      });

      function sendCmd() {
        const input = document.getElementById('cmd-input');
        if(input.value.trim()) {
          socket.emit('send_command', input.value.trim());
          input.value = '';
        }
      }

      function reconnect() {
        socket.emit('force_reconnect');
      }
    </script>
  </body>
  </html>
  `;
}

// ================= START SERVER =================
server.listen(PORT, () => {
  console.log(`[WEB] Control Panel http://localhost:${PORT} adresinde aktif.`);
  createBot();
});
