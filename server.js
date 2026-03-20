// server.js — République Politique Française
// Compatible Render.com (PORT auto) + usage local
const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');
const AbortController = require('abort-controller');

const app  = express();
const PORT = process.env.PORT || 3000;

// Clé API
let API_KEY = process.env.ANTHROPIC_API_KEY || '';
if (!API_KEY) {
  try { API_KEY = fs.readFileSync(path.join(__dirname, 'api_key.txt'), 'utf8').trim(); } catch {}
}
console.log(API_KEY ? '🔑 Clé API chargée.' : '[!] Pas de clé API — IA désactivée.');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Proxy RSS ─────────────────────────────────────────────────────────
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

// ── Proxy images Wikipedia — contourne le blocage hotlinking ─────────
app.get('/img', async (req, res) => {
  const url = req.query.url;
  if (!url || !url.includes('wikimedia.org')) return res.status(400).send('URL invalide');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 République-Politique-Site/1.0',
        'Referer': 'https://fr.wikipedia.org/'
      }
    });
    clearTimeout(timer);
    const type = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const buf = await r.buffer();
    res.send(buf);
  } catch(e) {
    clearTimeout(timer);
    res.status(500).send('Erreur');
  }
});

// ── Route IA Recherche — Claude Sonnet (intelligent, ~0.01$/requête) ──
// Utilisé pour la recherche d'articles : analyse sémantique poussée
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
        max_tokens: req.body.max_tokens || 600,
        system: req.body.system || 'Tu es un expert en politique française, neutre et objectif.',
        messages: req.body.messages
      })
    });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Route IA Comparaison — Claude Haiku (~0.001$/requête = 1000 pour 1$) ──
// Utilisé pour générer la synthèse gauche/droite : tâche simple et courte
app.post('/ai-compare', async (req, res) => {
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
        model: 'claude-haiku-4-5-20251001', // Haiku = 10x moins cher que Sonnet
        max_tokens: 300, // Réponse courte = moins de tokens = moins cher
        system: `Tu es un analyste politique français neutre et objectif.
On te donne des titres d'articles de presse de gauche et de droite sur un même sujet.
Tu dois rédiger en 3-4 phrases MAXIMUM une synthèse neutre qui explique :
- Comment la gauche traite ce sujet (1-2 phrases)
- Comment la droite traite ce sujet (1-2 phrases)
Sois factuel, concis et équilibré. Pas de jugement de valeur.`,
        messages: req.body.messages
      })
    });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Serveur lancé sur le port ${PORT}`);
  console.log(`🤖 IA Recherche : Claude Sonnet (~0.01$/requête)`);
  console.log(`⚖️  IA Comparaison : Claude Haiku (~0.001$/requête = 1000 pour 1$)\n`);
});
