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
  version: '1.16.5',
  reconnectDelay: 30000,
  
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
      checkTimeoutInterval: 120000,
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

  // AÇILAN MENÜLERİ CANLI WEB PANLEİNE GÖNDER
  bot.on('windowOpen', (window) => {
    console.log(`[MENÜ AÇILDI] Window ID: ${window.id}`);
    sendWindowToUI(window);
  });

  bot.on('windowClose', () => {
    io.emit('window_closed');
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
    emitStatus('Hata: ' + (err.code || err.message));
  });

  bot.on('end', (reason) => {
    console.log(`[BOT] Bağlantı koptu (${reason}). ${CONFIG.reconnectDelay / 1000}s sonra tekrar deneniyor...`);
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

function sendWindowToUI(window) {
  if (!window) return;

  let title = 'Sandık / Menü';
  try {
    if (window.title) {
      const parsed = JSON.parse(window.title);
      title = parsed.text || parsed.translate || window.title;
    }
  } catch(e) {
    title = window.title || 'Sandık / Menü';
  }

  const slots = window.slots.map((s, idx) => {
    if (!s) return null;
    let customName = s.customName || s.displayName || s.name;
    try {
      if (s.customName && s.customName.startsWith('{')) {
        const parsed = JSON.parse(s.customName);
        customName = parsed.text || customName;
      }
    } catch(e) {}

    return {
      slot: idx,
      name: s.name,
      count: s.count,
      displayName: customName
    };
  });

  io.emit('window_data', {
    id: window.id,
    title: title,
    slotsCount: window.inventoryStart || window.slots.length,
    slots: slots
  });
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

// ================= GELİŞMİŞ KAKAO SATIŞ MODÜLÜ =================
async function sellCocoaBeans() {
  if (!bot || !bot.entity) return;

  console.log('[ÇİFTÇİ] Kakao satış süreci tetiklendi...');

  // 1. DİREKT CHAT KOMUTLARI İLE DENE (En hızlı yol)
  bot.chat('/çiftçi sat');
  await new Promise(r => setTimeout(r, 800));
  bot.chat('/ciftci sat');
  await new Promise(r => setTimeout(r, 800));
  bot.chat('/çiftçi deposat');
  await new Promise(r => setTimeout(r, 800));

  // 2. MENÜ AÇARAK ZİNCİRLEME TIKLAMA YÖNTEMİ
  const windowHandler = async (window) => {
    sendWindowToUI(window);
    await new Promise(r => setTimeout(r, 1200));

    if (!bot || !bot.currentWindow) return;

    // A) Doğrudan Kakao / Satış Butonları
    const sellTarget = window.slots.find(s => s && (
      s.name.includes('cocoa') ||
      s.name.includes('brown_dye') ||
      s.name.includes('bean') ||
      s.name.includes('emerald') ||
      s.name.includes('gold_ingot') ||
      (s.customName && (s.customName.toLowerCase().includes('kakao') || s.customName.toLowerCase().includes('sat') || s.customName.toLowerCase().includes('tümünü'))) ||
      (s.displayName && (s.displayName.toLowerCase().includes('kakao') || s.displayName.toLowerCase().includes('sat') || s.displayName.toLowerCase().includes('tümünü')))
    ));

    if (sellTarget) {
      console.log(`[ÇİFTÇİ] Satış butonu bulundu (Slot ${sellTarget.slot}). Sol, Sağ ve Shift Tık gönderiliyor...`);
      try {
        // Çiftçi eklentilerinde Sağ Tık veya Shift Tık satabilir, üçünü de gönderiyoruz:
        await bot.clickWindow(sellTarget.slot, 0, 0); // Sol tık
        await new Promise(r => setTimeout(r, 400));
        await bot.clickWindow(sellTarget.slot, 1, 0); // Sağ tık
        await new Promise(r => setTimeout(r, 400));
        await bot.clickWindow(sellTarget.slot, 0, 1); // Shift + Sol tık
        console.log('[ÇİFTÇİ] Satış tıklamaları tamamlandı!');
      } catch (err) {
        console.error('[ÇİFTÇİ] Tıklama hatası:', err.message);
      }
      return;
    }

    // B) Depo / Sandık Butonu
    const storageTarget = window.slots.find(s => s && (
      s.name.includes('chest') ||
      s.name.includes('shulker') ||
      s.name.includes('barrel') ||
      (s.customName && (s.customName.toLowerCase().includes('depo') || s.customName.toLowerCase().includes('ürün') || s.customName.toLowerCase().includes('sandık'))) ||
      (s.displayName && (s.displayName.toLowerCase().includes('depo') || s.displayName.toLowerCase().includes('ürün') || s.displayName.toLowerCase().includes('sandık')))
    ));

    if (storageTarget) {
      console.log(`[ÇİFTÇİ] Depo butonu bulundu (Slot ${storageTarget.slot}). Giriliyor...`);
      try {
        await bot.clickWindow(storageTarget.slot, 0, 0);
      } catch (err) {
        console.error('[ÇİFTÇİ] Depo tıklama hatası:', err.message);
      }
    }
  };

  bot.once('windowOpen', windowHandler);
  bot.chat('/çiftçi');

  setTimeout(() => {
    if (bot) bot.removeListener('windowOpen', windowHandler);
  }, 12000);
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

  if (bot && bot.currentWindow) {
    sendWindowToUI(bot.currentWindow);
  }

  socket.on('send_command', async (cmd) => {
    if (!bot) return;

    if (cmd === '/sat') {
      sellCocoaBeans();
      return;
    }

    bot.chat(cmd);
  });

  // CANLI WEB INSPECTOR'DAN GELEN TIKLAMA İSTEKLERİ
  socket.on('click_slot', async (data) => {
    // data: { slot: number, button: 0|1, mode: 0|1 }
    if (!bot || !bot.currentWindow) {
      console.log('[PANEL] Oyunda açık bir menü yok!');
      return;
    }

    try {
      const slot = parseInt(data.slot);
      const button = data.button || 0; // 0 = Sol, 1 = Sağ
      const mode = data.mode || 0;     // 0 = Normal, 1 = Shift
      await bot.clickWindow(slot, button, mode);
      console.log(`[PANEL] Menü Slot ${slot} tıklandı (Buton: ${button}, Mod: ${mode})`);
    } catch (err) {
      console.error('[PANEL] Slot tıklama hatası:', err.message);
    }
  });

  socket.on('close_window', () => {
    if (bot && bot.currentWindow) {
      bot.closeWindow(bot.currentWindow);
    }
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
      body { background: #121214; color: #e1e1e6; padding: 20px; display: flex; flex-direction: column; gap: 20px; min-height: 100vh; }
      header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #29292e; padding-bottom: 15px; }
      h1 { font-size: 1.4rem; color: #00b37e; }
      .status-badge { background: #202024; padding: 6px 12px; border-radius: 6px; font-weight: bold; border: 1px solid #323238; }
      .grid { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; flex: 1; }
      .card { background: #202024; border: 1px solid #323238; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 10px; }
      .stat-row { display: flex; justify-content: space-between; background: #121214; padding: 10px; border-radius: 6px; }
      #chat-box { flex: 1; min-height: 200px; max-height: 300px; background: #121214; border-radius: 6px; padding: 10px; overflow-y: auto; font-family: monospace; font-size: 0.9rem; border: 1px solid #323238; }
      .chat-line { margin-bottom: 4px; word-break: break-word; }
      .chat-system { color: #8d8d99; }
      .input-group { display: flex; gap: 10px; }
      input { flex: 1; background: #121214; border: 1px solid #323238; color: #fff; padding: 10px; border-radius: 6px; outline: none; }
      button { background: #00b37e; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; }
      button:hover { background: #00875f; }
      .btn-danger { background: #f75a68; }
      .btn-danger:hover { background: #ce404d; }
      .btn-warning { background: #e0a96d; color: #121214; }

      /* GUI INSPECTOR STYLES */
      .gui-container { display: none; background: #18181b; border: 2px solid #00b37e; border-radius: 8px; padding: 15px; margin-top: 10px; }
      .gui-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .gui-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 6px; background: #09090a; padding: 10px; border-radius: 6px; border: 1px solid #27272a; }
      .gui-slot { background: #27272a; border: 1px solid #3f3f46; border-radius: 4px; padding: 6px; min-height: 55px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; font-size: 0.75rem; position: relative; cursor: pointer; }
      .gui-slot:hover { border-color: #00b37e; background: #3f3f46; }
      .slot-num { position: absolute; top: 2px; left: 4px; font-size: 0.65rem; color: #71717a; }
      .item-count { position: absolute; bottom: 2px; right: 4px; font-weight: bold; color: #f59e0b; font-size: 0.75rem; }
      .item-title { word-break: break-word; color: #e4e4e7; font-weight: 600; font-size: 0.7rem; margin-top: 6px; }
      .click-actions { display: flex; gap: 4px; margin-top: 4px; }
      .btn-mini { padding: 2px 4px; font-size: 0.6rem; border-radius: 3px; }
      .btn-blue { background: #3b82f6; }
      .btn-purple { background: #8b5cf6; }
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
          <input type="text" id="cmd-input" placeholder="Komut gönderin (/çiftçi vb)..." onkeydown="if(event.key==='Enter') sendCmd()">
          <button onclick="sendCmd()">Gönder</button>
        </div>
      </div>
    </div>

    <!-- CANLI SANDIK GUI İNCELEYİCİ -->
    <div class="gui-container" id="gui-box">
      <div class="gui-header">
        <h3 style="color:#00b37e;" id="gui-title">Açık Menü (Sandık)</h3>
        <button class="btn-danger btn-mini" style="padding:6px 12px;" onclick="closeGui()">Menüyü Kapat</button>
      </div>
      <div class="gui-grid" id="gui-grid"></div>
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

      // SANDIK GÖRSEL INSPECTOR ALGINDIĞINDA EKRANA BASSIN
      socket.on('window_data', data => {
        const guiBox = document.getElementById('gui-box');
        const guiTitle = document.getElementById('gui-title');
        const guiGrid = document.getElementById('gui-grid');

        guiBox.style.display = 'block';
        guiTitle.innerText = 'Açık Menü: ' + data.title;
        guiGrid.innerHTML = '';

        data.slots.forEach((s, idx) => {
          if (idx >= data.slotsCount) return; // Sadece üst sandığı göster

          const slotDiv = document.createElement('div');
          slotDiv.className = 'gui-slot';

          if (s) {
            slotDiv.innerHTML = \`
              <span class="slot-num">\${s.slot}</span>
              <span class="item-title">\${s.displayName}</span>
              <span class="item-count">\${s.count > 1 ? 'x'+s.count : ''}</span>
              <div class="click-actions">
                <button class="btn-mini" onclick="clickSlot(\${s.slot}, 0, 0)">Sol Tık</button>
                <button class="btn-mini btn-blue" onclick="clickSlot(\${s.slot}, 1, 0)">Sağ Tık</button>
                <button class="btn-mini btn-purple" onclick="clickSlot(\${s.slot}, 0, 1)">Shift</button>
              </div>
            \`;
          } else {
            slotDiv.innerHTML = \`<span class="slot-num">\${idx}</span>\`;
          }

          guiGrid.appendChild(slotDiv);
        });
      });

      socket.on('window_closed', () => {
        document.getElementById('gui-box').style.display = 'none';
      });

      function clickSlot(slot, button, mode) {
        socket.emit('click_slot', { slot, button, mode });
      }

      function closeGui() {
        socket.emit('close_window');
        document.getElementById('gui-box').style.display = 'none';
      }

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
