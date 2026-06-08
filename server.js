const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = 'https://wzjhwtijdjgfqniuszhy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6amh3dGlqZGpnZnFuaXVzemh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTA5NzMsImV4cCI6MjA5NjQ4Njk3M30.pz2RHRtcHWw7IKo0l36hAmYaHd-uS1m0fCESQAeqqUo';

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
    const { user_id, username, first_name, ref_code } = req.body;
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
    const { user_id, coins, energy, tap_power, businesses, ref_count, ref_earned } = req.body;
    console.log('Save istegi:', user_id, 'coins:', coins);

    await db('PATCH', 'users', {
      coins: coins,
      energy: energy,
      tap_power: tap_power,
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

app.get('/', (req, res) => res.json({ status: 'ZRo Farm API calisiyor' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server calisiyor: port ' + PORT));
