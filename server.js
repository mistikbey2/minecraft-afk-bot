const express = require('express');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const bots = {};
let webClients = [];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const FOOD_ITEMS = [
  'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
  'cooked_salmon', 'cooked_cod', 'bread', 'apple', 'golden_apple', 'baked_potato'
];

const AXES = ['netherite_axe', 'diamond_axe', 'iron_axe', 'golden_axe', 'stone_axe', 'wooden_axe'];
const SWORDS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'golden_sword', 'stone_sword', 'wooden_sword'];

const SAPLINGS = [
  'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling',
  'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'mangrove_propagule'
];

const LOGS = [
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log',
  'oak_wood', 'spruce_wood', 'birch_wood', 'jungle_wood'
];

const botStats = {};

app.get('/api/chat-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  webClients.push(res);
  req.on('close', () => { webClients = webClients.filter(client => client !== res); });
});

function sendToWeb(botName, message, type = 'normal') {
  webClients.forEach(client => {
    client.write(`data: ${JSON.stringify({ botName, message, type, time: new Date().toLocaleTimeString() })}\n\n`);
  });
}

async function sendDiscordWebhook(webhookUrl, title, description, color = 65280) {
  if (!webhookUrl || !webhookUrl.startsWith('http')) return;
  try {
    const fetch = (await import('node-fetch')).default;
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{ title, description, color, footer: { text: 'Minecraft Pro Bot V2' }, timestamp: new Date() }]
      })
    });
  } catch (e) {}
}

async function checkAndEat(bot, username) {
  if (bot.food !== undefined && bot.food < 16) {
    const foodItem = bot.inventory.items().find(i => FOOD_ITEMS.includes(i.name));
    if (foodItem) {
      try {
        await bot.equip(foodItem, 'hand');
        await bot.consume();
        sendToWeb(username, `[Oto-Yemek] ${foodItem.displayName || foodItem.name} yendi! (Açlık: ${bot.food}/20)`, 'system');
      } catch (e) {}
    }
  }
}

async function autoEquipArmor(bot) {
  const items = bot.inventory.items();
  const armorSlots = {
    helmet: items.filter(i => i.name.endsWith('_helmet')),
    chestplate: items.filter(i => i.name.endsWith('_chestplate')),
    leggings: items.filter(i => i.name.endsWith('_leggings')),
    boots: items.filter(i => i.name.endsWith('_boots'))
  };

  for (const [destination, pieceList] of Object.entries(armorSlots)) {
    if (pieceList.length > 0) {
      pieceList.sort((a, b) => b.name.localeCompare(a.name));
      try { await bot.equip(pieceList[0], destination); } catch(e) {}
    }
  }
}

// -------------------------------------------------------------
// OYUNCU TAKİP & AĞAÇ FARMI MODU
// -------------------------------------------------------------
async function runTreeFarmLoop(username) {
  const bData = bots[username];
  if (!bData || !bData.bot) return;
  const bot = bData.bot;

  while (bData.isTreeFarming) {
    try {
      if (!bot.entity) { await sleep(1000); continue; }

      const boneMeal = bot.inventory.items().find(i => i.name === 'bone_meal');
      const axe = bot.inventory.items().find(i => AXES.includes(i.name));
      const nearestPlayer = bot.nearestEntity(e => e.type === 'player' && e.username !== username);

      if (!boneMeal || !axe) {
        if (nearestPlayer && bot.entity.position.distanceTo(nearestPlayer.position) > 2.5) {
          bot.lookAt(nearestPlayer.position.offset(0, 1.6, 0));
          bot.setControlState('forward', true);
          await sleep(400);
          bot.setControlState('forward', false);
        } else {
          await sleep(1000);
        }
        continue;
      }

      const mcData = require('minecraft-data')(bot.version || '1.20.1');
      const saplingIds = SAPLINGS.map(s => mcData.blocksByName[s]?.id).filter(Boolean);
      let saplingBlock = bot.findBlock({ matching: saplingIds, maxDistance: 8 });

      if (!saplingBlock) {
        const invSapling = bot.inventory.items().find(i => SAPLINGS.includes(i.name));
        if (invSapling) {
          const dirtBlock = bot.findBlock({
            matching: block => block.name === 'dirt' || block.name === 'grass_block' || block.name === 'coarse_dirt',
            maxDistance: 4
          });
          if (dirtBlock) {
            try {
              await bot.equip(invSapling, 'hand');
              await bot.placeBlock(dirtBlock, new Vec3(0, 1, 0));
              sendToWeb(username, `[Ağaç Farmı] Envanterden fidan dikildi 🌱`, 'system');
              await sleep(800);
              saplingBlock = bot.findBlock({ matching: saplingIds, maxDistance: 8 });
            } catch(e) {}
          }
        }
      }

      if (saplingBlock) {
        await bot.lookAt(saplingBlock.position.offset(0.5, 0.5, 0.5));
        await bot.equip(boneMeal, 'hand');
        await bot.activateBlock(saplingBlock);
        sendToWeb(username, `[Ağaç Farmı] Fidana kemik tozu uygulandı ✨`, 'system');
        await sleep(900);

        const logIds = LOGS.map(l => mcData.blocksByName[l]?.id).filter(Boolean);
        let logBlock = bot.findBlock({ matching: logIds, maxDistance: 7 });

        if (logBlock) {
          await bot.equip(axe, 'hand');
          while (logBlock && bData.isTreeFarming) {
            await bot.lookAt(logBlock.position.offset(0.5, 0.5, 0.5));
            try {
              await bot.dig(logBlock);
              botStats[username].logsHarvested = (botStats[username].logsHarvested || 0) + 1;
              sendToWeb(username, `[Ağaç Farmı] Odun kırıldı! 🪓 (Toplam: ${botStats[username].logsHarvested})`, 'system');
            } catch(e) {}
            await sleep(350);
            logBlock = bot.findBlock({ matching: logIds, maxDistance: 7 });
          }
        }
      } else {
        if (nearestPlayer && bot.entity.position.distanceTo(nearestPlayer.position) > 2.5) {
          bot.lookAt(nearestPlayer.position.offset(0, 1.6, 0));
          bot.setControlState('forward', true);
          await sleep(400);
          bot.setControlState('forward', false);
        } else {
          await sleep(1000);
        }
      }
    } catch (err) {
      await sleep(1000);
    }
    await sleep(400);
  }
}

// -------------------------------------------------------------
// BOT OLUŞTURUCU ENGINE
// -------------------------------------------------------------
function createBotInstance(config) {
  const { username, host, port, password, version, autoChatMsg, webhookUrl } = config;

  if (bots[username] && bots[username].bot) {
    return { success: false, message: 'Bu kullanıcı adıyla aktif bir bot var!' };
  }

  sendToWeb(username, `[Sistem] Sunucuya bağlanılıyor: ${host}`, 'system');

  let bot;
  try {
    bot = mineflayer.createBot({
      host: host || 'tm.knightnw.com',
      port: parseInt(port) || 25565,
      username: username,
      auth: 'offline',
      version: version || '1.20.1',
      checkTimeoutInterval: 30 * 1000
    });
    bot.loadPlugin(pathfinder);
  } catch (err) {
    sendToWeb(username, `[Hata] Bot başlatılamadı: ${err.message}`, 'error');
    return { success: false, message: err.message };
  }

  botStats[username] = { startTime: Date.now(), logsHarvested: 0, mobsKilled: 0 };

  let chatTimer = null;
  let moveTimer = null;
  let attackTimer = null;
  let isInitialSpawn = true;

  bot.on('spawn', () => {
    if (isInitialSpawn) {
      isInitialSpawn = false;
      sendToWeb(username, `[Sistem] Oyuna girildi! Otomatik komutlar çalıştırılıyor...`, 'system');
      sendDiscordWebhook(webhookUrl, "🟢 Bot Sunucuya Bağlandı", `**Bot:** ${username}\n**Sunucu:** ${host}`, 3066993);

      if (password) {
        setTimeout(() => { if (bots[username]?.bot) bot.chat(`/login ${password}`); }, 4000);
      }
      setTimeout(() => { if (bots[username]?.bot) bot.chat('/skyblock'); }, 15000);
      setTimeout(() => { if (bots[username]?.bot) bot.chat('/is join'); }, 26000);
      setTimeout(() => { if (bots[username]?.bot) bot.chat('/is go'); }, 38000);

      if (chatTimer) clearInterval(chatTimer);
      chatTimer = setInterval(() => {
        if (bots[username]?.bot) {
          const b = bots[username].bot;
          if (b._client && b._client.state === 'play' && autoChatMsg) {
            try {
              b.chat(autoChatMsg);
              sendToWeb(username, `[Oto-Chat] AFK Tazeleme: ${autoChatMsg}`, 'system');
            } catch (e) {}
          }
        }
      }, 180000);

      if (moveTimer) clearInterval(moveTimer);
      moveTimer = setInterval(() => {
        if (bots[username]?.bot && bot.entity) {
          try {
            bot.setControlState('jump', true);
            setTimeout(() => { if (bots[username]?.bot) bot.setControlState('jump', false); }, 500);
            const yaw = (bot.entity.yaw || 0) + 0.5;
            bot.look(yaw, bot.entity.pitch || 0, true);
          } catch(e) {}
        }
      }, 15000);
    }
  });

  bot.on('health', () => {
    checkAndEat(bot, username);
    autoEquipArmor(bot);
  });

  bot.on('death', () => {
    sendToWeb(username, `[ÖLÜM] Bot öldü! 2s sonra doğuluyor...`, 'error');
    sendDiscordWebhook(webhookUrl, "⚠️ Bot Öldü!", `**Bot:** ${username} öldü. Yeniden doğuluyor...`, 15158332);
    setTimeout(() => {
      if (bots[username]?.bot) {
        try {
          bots[username].bot.respawn();
          setTimeout(() => { if (bots[username]?.bot) bots[username].bot.chat('/is go'); }, 3000);
        } catch(e) {}
      }
    }, 2000);
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim();
    if (text) sendToWeb(username, text, 'chat');
  });

  bot.on('kicked', (reason) => {
    let kickReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
    sendToWeb(username, `[ATILDI / KICK] ${kickReason}`, 'error');
    sendDiscordWebhook(webhookUrl, "🔴 Bot Sunucudan Atıldı", `**Bot:** ${username}\n**Sebep:** ${kickReason}`, 15158332);
  });

  bot.on('end', () => {
    sendToWeb(username, `[Sistem] Bağlantı koptu! 10sn sonra tekrar bağlanılacak...`, 'error');
    if (chatTimer) clearInterval(chatTimer);
    if (moveTimer) clearInterval(moveTimer);
    if (attackTimer) clearInterval(attackTimer);
    delete bots[username];

    setTimeout(() => {
      if (!bots[username]) createBotInstance(config);
    }, 10000);
  });

  bots[username] = {
    bot, config, chatTimer, moveTimer, attackTimer,
    isAttacking: false, isTreeFarming: false, isCropFarming: false
  };

  return { success: true };
}

// Varsayılan Bot
createBotInstance({
  username: 'mistikhanim',
  password: 'salakmustafa',
  host: 'tm.knightnw.com',
  port: 25565,
  version: '1.20.1',
  autoChatMsg: '/is go'
});

// API ENDPOINTS
app.get('/api/bots', (req, res) => res.json(Object.keys(bots).map(name => ({ username: name }))));

app.get('/api/status/:username', (req, res) => {
  const { username } = req.params;
  if (bots[username] && bots[username].bot) {
    const b = bots[username].bot;
    const pos = b.entity ? {
      x: Math.round(b.entity.position.x),
      y: Math.round(b.entity.position.y),
      z: Math.round(b.entity.position.z)
    } : { x: 0, y: 0, z: 0 };

    let radarEntities = [];
    if (b.entities && b.entity) {
      radarEntities = Object.values(b.entities)
        .filter(e => e && e.position && e.id !== b.entity.id)
        .map(e => ({
          id: e.id,
          name: e.username || e.displayName || e.name,
          type: e.type,
          relX: Math.round(e.position.x - b.entity.position.x),
          relZ: Math.round(e.position.z - b.entity.position.z),
          distance: Math.round(b.entity.position.distanceTo(e.position))
        }))
        .filter(e => e.distance <= 25);
    }

    res.json({
      success: true,
      health: b.health !== undefined ? Math.round(b.health) : 20,
      food: b.food !== undefined ? Math.round(b.food) : 20,
      level: b.experience?.level || 0,
      pos: pos,
      isAttacking: bots[username].isAttacking,
      isTreeFarming: bots[username].isTreeFarming,
      isCropFarming: bots[username].isCropFarming,
      stats: botStats[username] || {},
      radar: radarEntities
    });
  } else {
    res.status(404).json({ error: 'Bot bulunamadı!' });
  }
});

app.post('/api/toggle-treefarm', (req, res) => {
  const { username } = req.body;
  if (bots[username] && bots[username].bot) {
    const bData = bots[username];
    bData.isTreeFarming = !bData.isTreeFarming;

    if (bData.isTreeFarming) {
      sendToWeb(username, `[Sistem] Takip & Ağaç Farmı Modu AÇILDI 🌳🪓`, 'system');
      runTreeFarmLoop(username);
    } else {
      sendToWeb(username, `[Sistem] Ağaç Farmı KAPATILDI! /is go çekiliyor... 🏝️`, 'system');
      try { bots[username].bot.chat('/is go'); } catch(e) {}
    }
    res.json({ success: true, isTreeFarming: bData.isTreeFarming });
  } else {
    res.status(400).json({ error: 'Bot aktif değil!' });
  }
});

app.post('/api/deposit-chests', async (req, res) => {
  const { username } = req.body;
  if (bots[username] && bots[username].bot) {
    const bot = bots[username].bot;
    const chestBlock = bot.findBlock({ matching: block => block.name.includes('chest'), maxDistance: 5 });

    if (!chestBlock) return res.status(400).json({ error: '5 blok yarıçapta sandık bulunamadı!' });

    try {
      const chest = await bot.openChest(chestBlock);
      const itemsToDeposit = bot.inventory.items().filter(i => !SWORDS.includes(i.name) && !AXES.includes(i.name) && !FOOD_ITEMS.includes(i.name));

      for (const item of itemsToDeposit) {
        try { await chest.deposit(item.type, null, item.count); } catch(e) {}
        await sleep(300);
      }
      chest.close();
      sendToWeb(username, `[Sandık] Eşyalar sandığa aktarıldı! 📦`, 'system');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Sandık açılamadı!' });
    }
  } else {
    res.status(400).json({ error: 'Bot aktif değil!' });
  }
});

app.post('/api/send-chat', (req, res) => {
  const { username, message } = req.body;
  if (bots[username] && bots[username].bot) {
    try {
      bots[username].bot.chat(message);
      sendToWeb(username, `[Siteden Gönderildi]: ${message}`, 'user-sent');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(400).json({ error: 'Bot aktif değil!' });
  }
});

app.post('/api/add-bot', (req, res) => {
  const { username, password, host, port, version, autoChatMsg, webhookUrl } = req.body;
  if (!username) return res.status(400).json({ error: 'Kullanıcı adı zorunlu!' });

  const result = createBotInstance({
    username, password, host: host || 'tm.knightnw.com',
    port: port || 25565, version: version || '1.20.1',
    autoChatMsg: autoChatMsg || '/is go', webhookUrl
  });

  if (result.success) res.json({ success: true, message: `${username} başlatıldı!` });
  else res.status(400).json({ error: result.message });
});

app.get('/ping', (req, res) => res.send('Bot V2 Canlı!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Minecraft Pro V2 Server Aktif: ${PORT}`));
