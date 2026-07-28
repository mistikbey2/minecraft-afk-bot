const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Process Çökme Korumaları
process.on('uncaughtException', (err) => console.error('[KRİTİK HATA] Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('[KRİTİK HATA] Unhandled:', err));

// ================= CONFIGURATION =================
const CONFIG = {
  host: process.env.BOT_HOST || 'play.knightnw.com',
  port: parseInt(process.env.BOT_PORT) || 25565,
  username: process.env.BOT_USERNAME || 'mistikhanim',
  password: process.env.BOT_PASSWORD || 'salakmustafa',
  version: '1.16.5', // Sabit sürüm (BungeeCord kilitlenmesini önler)
  reconnectDelay: 60000, // IP Engeli (Ban) yememek için 60 saniye güvenli bekleme
  
  autoChatEnabled: true,
  autoChatInterval: 180000, // 3 Dakika
  autoChatMessages: ['sa', 'kolay gelsin beyler', 'afkyim', 'hb'],

  farmerEnabled: true,
  farmerInterval: 10 * 60 * 1000 // 10 Dakikada bir otomatik sat
};

// ================= EXPRESS & SOCKET.IO =================
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

let bot = null;
let antiAfkInterval = null;
let autoChatTimer = null;
let farmerTimer = null;

app.get('/', (req, res) => res.send(getDashboardHTML()));
app.get('/ping', (req, res) => res.status(200).send('OK - Bot Alive'));

// ================= MINEFLAYER BOT CREATION =================
function createBot() {
  console.log(`\n[BOT] ${CONFIG.host}:${CONFIG.port} adresine (${CONFIG.username}) bağlanılıyor...`);
  emitStatus('Sunucuya Bağlanılıyor...');

  try {
    bot = mineflayer.createBot({
      host: CONFIG.host,
      port: CONFIG.port,
      username: CONFIG.username,
      version: CONFIG.version,
      checkTimeoutInterval: 120000, // Zaman aşımı süresi 2 dakikaya çıkarıldı
    });
  } catch (err) {
    console.error('[BOT OLUŞTURMA HATASI]', err.message);
    scheduleReconnect();
    return;
  }

  bot.once('spawn', () => {
    console.log('[BOT] Oyuna başarıyla giriş yapıldı!');
    emitStatus('Bağlandı - Giriş Yapılıyor');

    setTimeout(() => {
      bot.chat(`/login ${CONFIG.password}`);
      console.log('[BOT] /login gönderildi.');
    }, 5000);

    setTimeout(() => {
      bot.chat('/skyblock');
      console.log('[BOT] /skyblock gönderildi.');
    }, 10000);

    setTimeout(() => {
      bot.chat('/is go');
      console.log('[BOT] /is go gönderildi.');
      emitStatus('Adaya Geçildi (AFK)');
    }, 15000);

    startAntiAFK();

    setTimeout(() => {
      if (CONFIG.autoChatEnabled) startAutoChat();
      if (CONFIG.farmerEnabled) startFarmerAutoSell();
    }, 25000);
  });

  bot.on('chat', (username, message) => {
    io.emit('chat_message', { type: 'chat', sender: username, text: message });
  });

  bot.on('message', (jsonMsg) => {
    const rawText = jsonMsg.toString();
    if (rawText.trim()) {
      console.log(`[SUNUCU] ${rawText}`);
      io.emit('chat_message', { type: 'system', text: rawText });
    }
  });

  bot.on('health', () => {
    io.emit('bot_stats', {
      health: bot.health,
      food: bot.food,
      pos: bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 }
    });
  });

  bot.on('kicked', (reason) => {
    let cleanReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
    console.log('[KICKED] Sunucudan atıldı:', cleanReason);
    emitStatus('Atıldı: ' + cleanReason);
    stopTimers();
  });

  bot.on('error', (err) => {
    console.error('[BAĞLANTI HATASI]:', err.code || err.message);
    if (err.code === 'ECONNREFUSED') {
      console.error('[TEŞHİS] Sunucu IP/Port bağlantıyı reddetti.');
    } else if (err.code === 'ETIMEDOUT') {
      console.error('[TEŞHİS] Zaman aşımı! KnightNW Güvenlik Duvarı Render IP\'sini engelliyor olabilir.');
    }
    emitStatus('Hata: ' + (err.code || err.message));
  });

  bot.on('end', (reason) => {
    console.log(`[BOT] Bağlantı koptu (Sebep: ${reason}). ${CONFIG.reconnectDelay / 1000}s sonra tekrar deneniyor...`);
    emitStatus(`Koptu - Bekleniyor...`);
    stopTimers();
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (bot) {
    bot.removeAllListeners();
    bot = null;
  }
  setTimeout(createBot, CONFIG.reconnectDelay);
}

// ================= MODÜLLER =================
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
  }, 20000);
}

function startAutoChat() {
  if (autoChatTimer) clearInterval(autoChatTimer);
  autoChatTimer = setInterval(() => {
    if (bot && bot.entity) {
      const msgs = CONFIG.autoChatMessages;
      const randomMsg = msgs[Math.floor(Math.random() * msgs.length)];
      bot.chat(randomMsg);
      console.log(`[AUTO-CHAT] ${randomMsg}`);
    }
  }, CONFIG.autoChatInterval);
}

function startFarmerAutoSell() {
  if (farmerTimer) clearInterval(farmerTimer);
  sellCocoaBeans();
  farmerTimer = setInterval(sellCocoaBeans, CONFIG.farmerInterval);
}

async function sellCocoaBeans() {
  if (!bot || !bot.entity) return;

  console.log('[ÇİFTÇİ] Satış döngüsü başlatıldı. /çiftçi yazılıyor...');

  const windowHandler = async (window) => {
    await new Promise(r => setTimeout(r, 1200));

    // Kakao / Hepsini Sat
    const sellTarget = window.slots.find(s => s && (
      s.name.includes('cocoa') ||
      s.name.includes('brown_dye') ||
      s.name.includes('bean') ||
      (s.customName && (s.customName.toLowerCase().includes('kakao') || s.customName.toLowerCase().includes('hepsini sat') || s.customName.toLowerCase().includes('tümünü sat')))
    ));

    if (sellTarget) {
      try {
        await bot.clickWindow(sellTarget.slot, 0, 0);
        console.log(`[ÇİFTÇİ] Slot ${sellTarget.slot} tıklandı.`);
      } catch (err) {}
      return;
    }

    // Depo / Sandık
    const storageTarget = window.slots.find(s => s && (
      s.name.includes('chest') ||
      s.name.includes('shulker') ||
      (s.customName && (s.customName.toLowerCase().includes('depo') || s.customName.toLowerCase().includes('ürün')))
    ));

    if (storageTarget) {
      try {
        await bot.clickWindow(storageTarget.slot, 0, 0);
      } catch (err) {}
    }
  };

  bot.on('windowOpen', windowHandler);
  bot.chat('/çiftçi');

  setTimeout(() => {
    if (bot) bot.removeListener('windowOpen', windowHandler);
  }, 15000);
}

function stopTimers() {
  if (antiAfkInterval) clearInterval(antiAfkInterval);
  if (autoChatTimer) clearInterval(autoChatTimer);
  if (farmerTimer) clearInterval(farmerTimer);
}

function emitStatus(status) {
  io.emit('bot_status', { status });
}

// ================= SOCKET.IO CLIENT EVENTS =================
io.on('connection', (socket) => {
  if (bot && bot.entity) {
    socket.emit('bot_stats', {
      health: bot.health,
      food: bot.food,
      pos: bot.entity.position
    });
  }

  socket.on('send_command', async (cmd) => {
    if (!bot) return;

    if (cmd.startsWith('/clickslot')) {
      const parts = cmd.split(' ');
      const slotNum = parseInt(parts[1]);
      if (!isNaN(slotNum) && bot.currentWindow) {
        try {
          await bot.clickWindow(slotNum, 0, 0);
        } catch(e) {}
      }
      return;
    }

    if (cmd === '/sat') {
      sellCocoaBeans();
      return;
    }

    bot.chat(cmd);
  });

  socket.on('force_reconnect', () => {
    scheduleReconnect();
  });
});

// ================= DASHBOARD UI =================
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
      .input-group { display: flex; gap: 10px; }
      input { flex: 1; background: #121214; border: 1px solid #323238; color: #fff; padding: 10px; border-radius: 6px; outline: none; }
      button { background: #00b37e; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; }
      button:hover { background: #00875f; }
      .btn-danger { background: #f75a68; }
      .btn-danger:hover { background: #ce404d; }
      .btn-warning { background: #e0a96d; color: #121214; }
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
        <button class="btn-warning" onclick="manualSell()">Anlık Kakao Sat Yap (/sat)</button>
        <button class="btn-danger" onclick="reconnect()">Yeniden Bağlan</button>
      </div>

      <div class="card">
        <h3>Canlı Oyun Chat & Konsol</h3>
        <div id="chat-box"></div>
        <div class="input-group">
          <input type="text" id="cmd-input" placeholder="Komut yazın..." onkeydown="if(event.key==='Enter') sendCmd()">
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

      function manualSell() {
        socket.emit('send_command', '/sat');
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
