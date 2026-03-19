// server.js — République Politique Française
// Compatible Render.com (PORT auto) + usage local
const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');
const AbortController = require('abort-controller');

const app  = express();
const PORT = process.env.PORT || 3000;

// Clé API : variable d'environnement (Render) OU fichier local
let API_KEY = process.env.ANTHROPIC_API_KEY || '';
if (!API_KEY) {
  try { API_KEY = fs.readFileSync(path.join(__dirname, 'api_key.txt'), 'utf8').trim(); } catch {}
}
console.log(API_KEY ? '🔑 Clé API chargée.' : '[!] Pas de clé API — IA désactivée.');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Proxy RSS — contourne le blocage CORS des navigateurs
app.get('/rss', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL manquante' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });
    clearTimeout(timer);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(await r.text());
  } catch (e) {
    clearTimeout(timer);
    res.status(500).json({ error: e.message });
  }
});

// Proxy Claude AI — sécurise la clé API côté serveur
app.post('/ai', async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'Clé API non configurée.' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: req.body.max_tokens || 1000,
        system: req.body.system || 'Tu es un expert en politique française, neutre et objectif.',
        messages: req.body.messages
      })
    });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
  console.log(`🤖 IA : ${API_KEY ? 'ACTIVÉE' : 'désactivée'}`);
});
