const express = require('express');
const mineflayer = require('mineflayer');
const { pathfinder, movements } = require('mineflayer-pathfinder');

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
// OTOMATİK ÇİFTÇİ KAKAO SATIŞ SİSTEMİ
// ==========================================
function startFarmerAutoSell() {
  if (farmerInterval) clearInterval(farmerInterval);

  addLog('🌾 Otomatik Çiftçi Kakao sistemi devrede! (Her 10 dk bir çalışacak)');

  // Oyuna girdikten 10 saniye sonra ilk satışı tetikler
  setTimeout(() => {
    executeFarmerSell();
  }, 10000);

  // Her 10 dakikada bir tekrarlar
  farmerInterval = setInterval(() => {
    executeFarmerSell();
  }, 10 * 60 * 1000);
}

async function executeFarmerSell() {
  if (!bot || !bot.entity) {
    addLog('Bot oyunda olmadığı için çiftçi satışı atlandı.');
    return;
  }

  addLog('/çiftçi komutu gönderiliyor...');
  bot.chat('/çiftçi');

  bot.once('windowOpen', async (window) => {
    addLog('Çiftçi menüsü açıldı, Zümrüt aranıyor...');

    const emeraldItem = window.items().find(i => 
      i.name.includes('emerald') || 
      (i.customName && i.customName.toLowerCase().includes('zümrüt'))
    );

    if (!emeraldItem) {
      addLog('Hata: Çiftçi menüsünde Zümrüt bulunamadı!');
      try { bot.closeWindow(window); } catch(e){}
      return;
    }

    try {
      await bot.clickWindow(emeraldItem.slot, 0, 0);
      addLog('Zümrüte tıklandı, Satış menüsü bekleniyor...');

      bot.once('windowOpen', async (nextWindow) => {
        addLog('Satış menüsü açıldı, Kakao Çekirdeği aranıyor...');

        const cocoaItem = nextWindow.items().find(i => 
          i.name.includes('cocoa') || 
          i.name.includes('bean') ||
          (i.customName && i.customName.toLowerCase().includes('kakao'))
        );

        if (!cocoaItem) {
          addLog('Hata: Menüde Kakao Çekirdeği bulunamadı!');
          try { bot.closeWindow(nextWindow); } catch(e){}
          return;
        }

        await bot.clickWindow(cocoaItem.slot, 0, 0);
        addLog('✅ Kakao Çekirdeğine sol tık yapıldı ve satış tamamlandı!');

        setTimeout(() => {
          try { bot.closeWindow(nextWindow); } catch (e) {}
        }, 1000);
      });

    } catch (err) {
      addLog(`Çiftçi menü tıklama hatası: ${err.message}`);
    }
  });
}

// ==========================================
// MINEFLAYER BOT
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
    startFarmerAutoSell();
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    addChat(username, message);
  });

  bot.on('messagestr', (message) => {
    if (!message) return;
    if (!message.includes(': ')) {
      addChat('SYSTEM', message);
    }
  });

  bot.on('health', () => {
    botState.health = Math.round(bot.health);
    botState.food = Math.round(bot.food);
    
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
    if (farmerInterval) clearInterval(farmerInterval);
    setTimeout(createBot, 10000);
  });
}

function updateInventory() {
  if (!bot || !bot.inventory) return;
  botState.inventory = bot.inventory.items().map(item => ({
    slot: item.slot,
    name: item.name,
    displayName: item.displayName,
    count: item.count
  }));
}

createBot();

// ==========================================
// API & WEB PANEL
// ==========================================
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/api/status', (req, res) => res.json(botState));

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Minecraft Otomatik Çiftçi Panel</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
        body { background: #0f0f12; color: #dcddde; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; background: #18181c; padding: 20px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #28282e; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .card { background: #18181c; padding: 20px; border-radius: 12px; border: 1px solid #28282e; }
        h2 { font-size: 1.1rem; color: #fff; margin-bottom: 12px; border-bottom: 1px solid #28282e; padding-bottom: 8px; }
        .stat { background: #111114; padding: 10px; border-radius: 6px; margin-bottom: 8px; font-weight: bold; }
        .logs { height: 250px; overflow-y: auto; background: #0b0b0d; padding: 10px; border-radius: 8px; font-family: monospace; font-size: 0.8rem; color: #8e9297; border: 1px solid #28282e; }
        .log-entry { margin-bottom: 4px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🌾 Otomatik Çiftçi Bot Paneli</h1>
        <span id="status" style="color: #43b581; font-weight: bold;">Yükleniyor...</span>
    </div>

    <div class="grid">
        <div class="card">
            <h2>📊 Sistem Durumu</h2>
            <div class="stat">❤️ Can: <span id="health">20</span>/20</div>
            <div class="stat">🍗 Açlık: <span id="food">20</span>/20</div>
            <div class="stat">📍 Konum: <span id="pos">0, 0, 0</span></div>
            <div class="stat" style="color: #43b581;">⚙️ Modül: Otomatik Çiftçi Satış (10dk)</div>
        </div>

        <div class="card">
            <h2>📋 Canlı Otomasyon Logları</h2>
            <div class="logs" id="logs"></div>
        </div>
    </div>

    <script>
        async function update() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                document.getElementById('status').innerText = data.status;
                document.getElementById('health').innerText = data.health;
                document.getElementById('food').innerText = data.food;
                document.getElementById('pos').innerText = \`\${data.position.x}, \${data.position.y}, \${data.position.z}\`;
                document.getElementById('logs').innerHTML = data.logs.map(l => \`<div class="log-entry">\${l}</div>\`).join('');
            } catch (e) {}
        }
        setInterval(update, 2000);
        update();
    </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  addLog(`Server ${PORT} portunda aktif!`);
});
