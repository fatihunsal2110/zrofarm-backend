const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = 'https://wzjhwtijdjgfqniuszhy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6amh3dGlqZGpnZnFuaXVzemh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTA5NzMsImV4cCI6MjA5NjQ4Njk3M30.pz2RHRtcHWw7IKo0l36hAmYaHd-uS1m0fCESQAeqqUo';
const BOT_TOKEN = '8701041239:AAFQ7sm8SsMyBzYncNe1DI5ZPg6G_jOTOlk';

// Rate limiting - IP başına istek sayısı
const rateLimits = {};
function checkRateLimit(ip, limit=30, windowMs=60000){
  const now = Date.now();
  if(!rateLimits[ip]) rateLimits[ip] = [];
  rateLimits[ip] = rateLimits[ip].filter(t => now - t < windowMs);
  if(rateLimits[ip].length >= limit) return false;
  rateLimits[ip].push(now);
  return true;
}

// Rate limit temizle (1 saatte bir)
setInterval(() => {
  const now = Date.now();
  Object.keys(rateLimits).forEach(ip => {
    rateLimits[ip] = rateLimits[ip].filter(t => now - t < 60000);
    if(rateLimits[ip].length === 0) delete rateLimits[ip];
  });
}, 3600000);

// Telegram initData doğrulama
function verifyTelegramData(initData){
  if(!initData || !BOT_TOKEN || BOT_TOKEN === 'BOTOKENINI_YAZ') return true; // Geliştirme modunda geç
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if(!hash) return false;
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k,v]) => k+'='+v)
      .join('
');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    return hash === expectedHash;
  } catch(e) {
    console.log('initData dogrulama hatasi:', e.message);
    return true;
  }
}

// Coin artışı mantıklı mı kontrol et
function validateCoinIncrease(oldCoins, newCoins, businesses, tapPower, timeDiffSec){
  const diff = newCoins - oldCoins;
  if(diff < 0) return true; // Azalma normal (harcama)
  
  // Max pasif gelir hesapla
  const maxPassive = businesses.reduce((sum, b) => sum + (b.inc || 0), 0);
  
  // Max tap geliri: saniyede max 10 tap, her tap max tapPower
  const maxTapIncome = 10 * (tapPower || 1);
  
  // Toplam max kazanç (2x güvenlik marjı ile)
  const maxPossible = (maxPassive + maxTapIncome) * timeDiffSec * 2;
  
  if(diff > maxPossible + 50000){ // 50K sabit tolerans
    console.log('SUPHELI COIN ARTISI:', {oldCoins, newCoins, diff, maxPossible, timeDiffSec});
    return false;
  }
  return true;
}

async function db(method, table, body, query) {
  const url = SUPABASE_URL + '/rest/v1/' + table + (query || '');
  console.log('DB istek:', method, url);
  const opts = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=representation'
    }
  };
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  console.log('DB cevap:', res.status, text.substring(0, 200));
  try { return JSON.parse(text); } catch(e) { return text; }
}

app.post('/api/login', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if(!checkRateLimit(ip, 20, 60000)){
      return res.status(429).json({ success: false, error: 'Too many requests' });
    }

    const { user_id, username, first_name, ref_code, init_data } = req.body;
    console.log('Login istegi:', user_id, username);

    const existing = await db('GET', 'users', null, '?id=eq.' + user_id);

    if(Array.isArray(existing) && existing.length > 0) {
      console.log('Mevcut kullanici bulundu');
      return res.json({ success: true, user: existing[0] });
    }

    console.log('Yeni kullanici olusturuluyor...');
    const newUser = {
      id: parseInt(user_id) || user_id,
      username: username || '',
      first_name: first_name || 'Player',
      coins: 0,
      energy: 500,
      tap_power: 1,
      ref_code: 'USR_' + user_id,
      referred_by: ref_code || null,
      ref_count: 0,
      ref_earned: 0,
      businesses: []
    };

    const created = await db('POST', 'users', newUser);
    console.log('Olusturuldu:', JSON.stringify(created).substring(0, 100));

    if(ref_code && ref_code.startsWith('USR_')) {
      const refId = ref_code.replace('USR_', '');
      const refUser = await db('GET', 'users', null, '?id=eq.' + refId);
      if(Array.isArray(refUser) && refUser.length > 0) {
        const u = refUser[0];
        await db('PATCH', 'users', {
          ref_count: (u.ref_count || 0) + 1,
          ref_earned: (u.ref_earned || 0) + 500,
          coins: (u.coins || 0) + 500
        }, '?id=eq.' + refId);
      }
    }

    res.json({ success: true, user: Array.isArray(created) ? created[0] : newUser });
  } catch(err) {
    console.log('Login HATA:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/save', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    
    // Rate limit kontrolü
    if(!checkRateLimit(ip, 60, 60000)){
      console.log('RATE LIMIT:', ip);
      return res.status(429).json({ success: false, error: 'Too many requests' });
    }

    const { user_id, coins, energy, tap_power, businesses, ref_count, ref_earned, init_data } = req.body;
    console.log('Save istegi:', user_id, 'coins:', coins);

    // Mevcut kullanıcı verisini al
    const existing = await db('GET', 'users', null, '?id=eq.' + user_id);
    if(existing && existing.length > 0){
      const u = existing[0];
      const lastUpdate = new Date(u.updated_at).getTime();
      const timeDiffSec = Math.max(1, (Date.now() - lastUpdate) / 1000);

      // Coin artışı kontrolü
      if(!validateCoinIncrease(u.coins, coins, u.businesses||[], u.tap_power||1, timeDiffSec)){
        console.log('HILE TESPIT:', user_id, 'eskiCoins:', u.coins, 'yeniCoins:', coins);
        // Hileyi reddet, mevcut değeri koru
        return res.json({ success: false, error: 'Invalid coin increase', coins: u.coins });
      }
    }

    await db('PATCH', 'users', {
      coins: Math.floor(coins),
      energy: Math.min(energy, 50000), // Max enerji sınırı
      tap_power: Math.min(tap_power, 100), // Max tap gücü sınırı
      businesses: businesses,
      ref_count: ref_count,
      ref_earned: ref_earned,
      updated_at: new Date().toISOString()
    }, '?id=eq.' + user_id);

    res.json({ success: true });
  } catch(err) {
    console.log('Save HATA:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/user/:id', async (req, res) => {
  try {
    const data = await db('GET', 'users', null, '?id=eq.' + req.params.id);
    if(Array.isArray(data) && data.length > 0) {
      res.json({ success: true, user: data[0] });
    } else {
      res.json({ success: false, error: 'Kullanici bulunamadi' });
    }
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/referrals/:user_id', async (req, res) => {
  try {
    const refCode = 'USR_' + req.params.user_id;
    const data = await db('GET', 'users', null, '?referred_by=eq.' + refCode);
    res.json({ success: true, referrals: Array.isArray(data) ? data : [] });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// TON transaction doğrulama
async function verifyTonTransaction(boc, expectedAmount){
  try {
    // TonCenter API ile doğrula (ücretsiz)
    const res = await fetch('https://toncenter.com/api/v2/sendBoc', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ boc })
    });
    const data = await res.json();
    console.log('TON verify:', JSON.stringify(data).substring(0,200));
    return data.ok === true;
  } catch(e){
    console.log('TON verify hatasi:', e.message);
    return false;
  }
}

// TON boost doğrulama ve aktivasyon
app.post('/api/ton/verify', async (req, res) => {
  try {
    const { user_id, pkg_id, ton_amount, boc } = req.body;
    console.log('TON verify istegi:', user_id, pkg_id, ton_amount);

    // Transaction'ı blockchain'e gönder ve doğrula
    const verified = await verifyTonTransaction(boc, ton_amount);
    
    // Boost süreleri
    const durations = {
      'boost_1h':    3600000,
      'boost_daily': 86400000,
      'boost_weekly':604800000,
      'boost_monthly':2592000000,
      'energy_fill': 0,
    };

    // Kullanıcıya boost kaydet
    const user = await db('GET', 'users', null, '?id=eq.' + user_id);
    if(user && user.length > 0){
      const u = user[0];
      const boosts = u.active_boosts || {};
      
      if(pkg_id === 'energy_fill'){
        await db('PATCH', 'users', {
          energy: u.max_energy || 500,
          updated_at: new Date().toISOString()
        }, '?id=eq.' + user_id);
      } else if(pkg_id === 'premium'){
        await db('PATCH', 'users', {
          is_premium: true,
          updated_at: new Date().toISOString()
        }, '?id=eq.' + user_id);
      } else {
        const dur = durations[pkg_id] || 3600000;
        boosts[pkg_id] = Date.now() + dur;
        await db('PATCH', 'users', {
          active_boosts: boosts,
          updated_at: new Date().toISOString()
        }, '?id=eq.' + user_id);
      }

      // TON ödeme kaydı
      console.log('TON odeme kaydedildi:', user_id, pkg_id, ton_amount, 'TON');
    }

    res.json({ success: true, verified });
  } catch(err){
    console.log('TON verify HATA:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Enerji bildirimi gönder
async function sendEnergyNotification(userId, firstName, lang){
  try {
    const messages = {
      tr: '⚡ Enerjin doldu! ZRo Farm'a geri dön ve kazanmaya devam et!',
      en: '⚡ Your energy is full! Come back to ZRo Farm and keep mining!',
      ru: '⚡ Энергия полна! Вернись в ZRo Farm и продолжай добычу!',
      zh: '⚡ 你的能量已满！回到ZRo Farm继续挖矿！',
      ar: '⚡ طاقتك ممتلئة! عد إلى ZRo Farm واستمر في التعدين!',
      es: '⚡ ¡Tu energía está llena! Vuelve a ZRo Farm y sigue minando!',
      hi: '⚡ आपकी ऊर्जा पूरी हो गई! ZRo Farm पर वापस आएं और खनन जारी रखें!',
    };
    const msg = messages[lang] || messages['en'];
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        chat_id: userId,
        text: msg,
        reply_markup: {
          inline_keyboard: [[{
            text: '🎮 ZRo Farm',
            web_app: { url: 'https://fatihunsal2110.github.io/ZroFarmingBOT/index.html?v=20' }
          }]]
        }
      })
    });
    console.log('Enerji bildirimi gönderildi:', userId);
  } catch(e){
    console.log('Bildirim hatasi:', e.message);
  }
}

// Enerji bildirimi kaydet
app.post('/api/notify/energy', async (req, res) => {
  try {
    const { user_id, lang, energy_time } = req.body;
    // energy_time: enerjinin dolacağı zaman (ms)
    const delay = Math.max(0, energy_time - Date.now());
    const user = await db('GET', 'users', null, '?id=eq.' + user_id);
    const firstName = user && user[0] ? user[0].first_name : 'Player';
    
    setTimeout(async () => {
      // Kullanıcı hala düşük enerjili mi kontrol et
      const current = await db('GET', 'users', null, '?id=eq.' + user_id);
      if(current && current[0]){
        sendEnergyNotification(user_id, firstName, lang || 'en');
      }
    }, delay);
    
    res.json({ success: true, notifyIn: Math.floor(delay/1000) + ' saniye' });
  } catch(err){
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const data = await db('GET', 'users', null, '?order=coins.desc&limit=50&select=id,first_name,username,coins,ref_count');
    res.json({ success: true, leaderboard: Array.isArray(data) ? data : [] });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ZRo Farm API calisiyor' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server calisiyor: port ' + PORT));
