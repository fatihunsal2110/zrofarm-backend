const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = 'https://wzjhwtijdjgfqniuszhy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6amh3dGlqZGpnZnFuaXVzemh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTA5NzMsImV4cCI6MjA5NjQ4Njk3M30.pz2RHRtcHWw7IKo0l36hAmYaHd-uS1m0fCESQAeqqUo';

async function db(method, table, body, query) {
  const url = SUPABASE_URL + '/rest/v1/' + table + (query || '');
  const res = await fetch(url, {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// Kullanici yukle veya olustur
app.post('/api/login', async (req, res) => {
  try {
    const { user_id, username, first_name, ref_code } = req.body;

    // Kullanici var mi kontrol et
    const existing = await db('GET', 'users', null, '?id=eq.' + user_id);

    if (existing && existing.length > 0) {
      return res.json({ success: true, user: existing[0] });
    }

    // Yeni kullanici olustur
    const newUser = {
      id: user_id,
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

    // Referral bonusu ver
    if (ref_code && ref_code.startsWith('USR_')) {
      const refId = ref_code.replace('USR_', '');
      const refUser = await db('GET', 'users', null, '?id=eq.' + refId);
      if (refUser && refUser.length > 0) {
        const u = refUser[0];
        await db('PATCH', 'users', {
          ref_count: u.ref_count + 1,
          ref_earned: u.ref_earned + 500,
          coins: u.coins + 500
        }, '?id=eq.' + refId);
      }
    }

    res.json({ success: true, user: created[0] || newUser });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Oyun durumunu kaydet
app.post('/api/save', async (req, res) => {
  try {
    const { user_id, coins, energy, tap_power, businesses, ref_count, ref_earned } = req.body;

    await db('PATCH', 'users', {
      coins,
      energy,
      tap_power,
      businesses,
      ref_count,
      ref_earned,
      updated_at: new Date().toISOString()
    }, '?id=eq.' + user_id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Oyun durumunu yukle
app.get('/api/user/:id', async (req, res) => {
  try {
    const data = await db('GET', 'users', null, '?id=eq.' + req.params.id);
    if (data && data.length > 0) {
      res.json({ success: true, user: data[0] });
    } else {
      res.json({ success: false, error: 'Kullanici bulunamadi' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Referral listesi
app.get('/api/referrals/:user_id', async (req, res) => {
  try {
    const refCode = 'USR_' + req.params.user_id;
    const data = await db('GET', 'users', null, '?referred_by=eq.' + refCode);
    res.json({ success: true, referrals: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ZRo Farm API calisiyor' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server calisiyor: port ' + PORT));
