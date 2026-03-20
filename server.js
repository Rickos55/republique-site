// server.js — République Politique Française
const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');
const AbortController = require('abort-controller');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CLÉS API ──────────────────────────────────────────────────────────
let API_KEY = process.env.ANTHROPIC_API_KEY || '';
if (!API_KEY) {
  try { API_KEY = fs.readFileSync(path.join(__dirname, 'api_key.txt'), 'utf8').trim(); } catch {}
}
const MC_API_KEY  = process.env.MAILCHIMP_API_KEY  || '';
const MC_LIST_ID  = process.env.MAILCHIMP_LIST_ID  || '';
const MC_SERVER   = MC_API_KEY ? MC_API_KEY.split('-')[1] : 'us10';
const STRIPE_KEY  = process.env.STRIPE_SECRET_KEY  || '';
const STRIPE_PRICE = process.env.STRIPE_PRICE_ID   || '';
const SITE_URL    = process.env.SITE_URL || 'https://republique-politique.fr';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'republique-admin-2026';
const NL_TOKEN    = process.env.NEWSLETTER_TOKEN || 'republique2026';

console.log(API_KEY    ? '🔑 Claude OK'    : '[!] Pas de clé Claude');
console.log(MC_API_KEY ? '📧 Mailchimp OK' : '[!] Pas de clé Mailchimp');
console.log(STRIPE_KEY ? '💳 Stripe OK'    : '[!] Pas de clé Stripe');

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
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' }
    });
    clearTimeout(timer);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(await r.text());
  } catch (e) { clearTimeout(timer); res.status(500).json({ error: e.message }); }
});

// ── Proxy images Wikipedia ────────────────────────────────────────────
app.get('/img', async (req, res) => {
  const url = req.query.url;
  if (!url || !url.includes('wikimedia.org')) return res.status(400).send('URL invalide');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fr.wikipedia.org/' } });
    clearTimeout(timer);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(await r.buffer());
  } catch(e) { clearTimeout(timer); res.status(500).send('Erreur'); }
});

// ── IA Recherche — Claude Sonnet ──────────────────────────────────────
app.post('/ai', async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'Clé API non configurée.' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: req.body.max_tokens || 600, system: req.body.system || 'Tu es un expert en politique française, neutre et objectif.', messages: req.body.messages })
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── IA Comparaison — Claude Haiku ─────────────────────────────────────
app.post('/ai-compare', async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'Clé API non configurée.' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: 'Tu es un analyste politique français neutre. Rédige en 3-4 phrases simples une synthèse neutre. Pas de markdown, pas de #, pas de *, texte simple uniquement.', messages: req.body.messages })
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Inscription newsletter gratuite ───────────────────────────────────
app.post('/newsletter/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email invalide' });
  if (!MC_API_KEY || !MC_LIST_ID) return res.status(503).json({ error: 'Mailchimp non configuré' });
  try {
    const r = await fetch('https://' + MC_SERVER + '.api.mailchimp.com/3.0/lists/' + MC_LIST_ID + '/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + Buffer.from('anystring:' + MC_API_KEY).toString('base64') },
      body: JSON.stringify({ email_address: email, status: 'subscribed', tags: ['gratuit'] })
    });
    const data = await r.json();
    if (r.status === 200 || r.status === 201) {
      res.json({ success: true, message: 'Inscrit avec succès !' });
    } else if (data.title === 'Member Exists') {
      res.json({ success: true, message: 'Vous êtes déjà inscrit !' });
    } else {
      res.status(400).json({ error: data.detail || 'Erreur inscription' });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Stripe Checkout ───────────────────────────────────────────────────
app.post('/stripe/checkout', async (req, res) => {
  if (!STRIPE_KEY) return res.status(503).json({ error: 'Stripe non configuré.' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis.' });
  try {
    const params = new URLSearchParams({
      'mode': 'subscription',
      'customer_email': email,
      'line_items[0][price]': STRIPE_PRICE,
      'line_items[0][quantity]': '1',
      'success_url': SITE_URL + '/premium-success?session_id={CHECKOUT_SESSION_ID}',
      'cancel_url': SITE_URL + '/#apropos',
      'locale': 'fr',
      'allow_promotion_codes': 'true'
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const session = await r.json();
    if (session.url) {
      res.json({ url: session.url });
    } else {
      res.status(500).json({ error: session.error?.message || 'Erreur Stripe' });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Stripe Webhook ────────────────────────────────────────────────────
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try { event = JSON.parse(req.body); } catch(e) { return res.status(400).send('Parse error'); }
  if (event.type === 'checkout.session.completed') {
    const email = event.data.object.customer_email || event.data.object.customer_details?.email;
    if (email && MC_API_KEY && MC_LIST_ID) {
      try {
        await fetch('https://' + MC_SERVER + '.api.mailchimp.com/3.0/lists/' + MC_LIST_ID + '/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + Buffer.from('anystring:' + MC_API_KEY).toString('base64') },
          body: JSON.stringify({ email_address: email, status: 'subscribed', tags: ['premium'] })
        });
        console.log('✅ Nouvel abonné premium: ' + email);
      } catch(e) { console.error('Erreur Mailchimp webhook:', e.message); }
    }
  }
  res.json({ received: true });
});

// ── Page succès Stripe ────────────────────────────────────────────────
app.get('/premium-success', (req, res) => {
  res.send('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Merci — République</title><style>body{font-family:Arial,sans-serif;background:#0D2B6E;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{background:#fff;border-radius:20px;padding:3rem;text-align:center;max-width:480px;width:90%}h1{color:#0D2B6E;font-size:2rem;margin-bottom:.5rem}.badge{background:gold;color:#1A1A1A;font-weight:700;padding:.4rem 1.2rem;border-radius:50px;font-size:.9rem;display:inline-block;margin-bottom:1.2rem}.btn{background:#0D2B6E;color:#fff;padding:.8rem 2rem;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-top:.5rem}</style></head><body><div class="box"><div style="font-size:3rem">🎉</div><h1>Bienvenue !</h1><div class="badge">⭐ Abonné Premium</div><p>Votre abonnement est confirmé. Vous recevrez votre première newsletter demain à 7h.</p><a href="https://republique-politique.fr" class="btn">Retour au site →</a></div></body></html>');
});

// ── Helpers newsletter ────────────────────────────────────────────────
async function fetchNewsletterArticles() {
  const FEEDS = [
    'https://www.lemonde.fr/politique/rss_full.xml',
    'https://www.lefigaro.fr/rss/figaro_politique.xml',
    'https://www.francetvinfo.fr/politique.rss',
    'https://www.liberation.fr/arc/outboundfeeds/rss-all/',
    'https://www.bfmtv.com/rss/news-24-7/',
    'https://www.lesechos.fr/rss/rss_politique.xml',
    'https://la1ere.francetvinfo.fr/guyane/rss',
    'https://www.ouest-france.fr/rss-en-continu.xml',
  ];
  const articles = [];
  for (const url of FEEDS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(t);
      const txt = await r.text();
      const items = txt.match(/<item>[\s\S]*?<\/item>/g) || [];
      items.slice(0, 5).forEach(item => {
        const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1] || '';
        const link  = (item.match(/<link>(.*?)<\/link>/))?.[1] || '';
        if (title.length > 10) articles.push({ title: title.trim(), link: link.trim() });
      });
    } catch {}
  }
  return articles;
}

function getField(text, key) {
  const m = text.match(new RegExp(key + ':\\s*(.+)'));
  return m ? m[1].trim() : '';
}

async function generateNewsletter(type, articles) {
  const tops = articles.slice(0, 20).map(function(a, i) { return (i+1) + '. ' + a.title; }).join('\n');
  const model = type === 'premium' ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001';
  const maxTokens = type === 'premium' ? 1500 : 700;
  const system = type === 'premium'
    ? 'Tu es un analyste politique français expert, neutre et rigoureux. Génère une newsletter premium détaillée.\nFormat exact (sans markdown) :\nTITRE: [titre accrocheur]\nINTRO: [2 phrases]\nNEWS1: [titre] | [2-3 phrases analyse]\nNEWS2: [titre] | [2-3 phrases analyse]\nNEWS3: [titre] | [2-3 phrases analyse]\nNEWS4: [titre] | [2-3 phrases analyse]\nNEWS5: [titre] | [2-3 phrases analyse]\nNEWS6: [titre] | [2-3 phrases analyse]\nNEWS7: [titre] | [2-3 phrases analyse]\nANALYSE_GAUCHE: [3 phrases]\nANALYSE_DROITE: [3 phrases]\nEXCLUSIF: [2 phrases angle exclusif]\nCONCLUSION: [1 phrase]'
    : 'Tu es un journaliste politique français neutre. Génère une newsletter quotidienne courte.\nFormat (sans markdown) :\nTITRE: [titre accrocheur]\nINTRO: [1 phrase]\nNEWS1: [titre court] | [1 phrase]\nNEWS2: [titre court] | [1 phrase]\nNEWS3: [titre court] | [1 phrase]\nNEWS4: [titre court] | [1 phrase]\nNEWS5: [titre court] | [1 phrase]\nCONCLUSION: [1 phrase]';

  const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: 'Articles du jour :\n' + tops + '\n\nGénère la newsletter.' }] })
  });
  const aiData = await aiResp.json();
  const aiText = aiData.content?.[0]?.text || '';

  const titre = getField(aiText, 'TITRE') || 'Revue de presse politique du jour';
  const intro = getField(aiText, 'INTRO') || '';
  const news = [1,2,3,4,5,6,7].map(function(i) {
    const line = getField(aiText, 'NEWS' + i);
    if (!line) return null;
    const parts = line.split('|');
    return { titre: (parts[0] || '').trim(), desc: (parts[1] || '').trim() };
  }).filter(Boolean);
  const analyseGauche = getField(aiText, 'ANALYSE_GAUCHE');
  const analyseDroite = getField(aiText, 'ANALYSE_DROITE');
  const exclusif = getField(aiText, 'EXCLUSIF');
  const conclusion = getField(aiText, 'CONCLUSION') || 'Bonne journée et à demain.';
  const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  return { titre, intro, news, analyseGauche, analyseDroite, exclusif, conclusion, today };
}

function buildEmailHTML(type, data) {
  const newsRows = data.news.map(function(n, i) {
    return '<tr><td style="padding:12px 0;border-bottom:1px solid #E0D9CF"><div style="display:flex;align-items:flex-start;gap:10px"><span style="background:#0D2B6E;color:#fff;font-weight:700;font-size:11px;padding:2px 8px;border-radius:50px;white-space:nowrap;margin-top:2px">' + (i+1) + '</span><div><div style="font-weight:700;font-size:15px;color:#1A1A1A;margin-bottom:4px">' + n.titre + '</div><div style="font-size:13px;color:#555;line-height:1.6">' + n.desc + '</div></div></div></td></tr>';
  }).join('');

  const premiumSection = type === 'premium' ? (
    '<tr><td><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="50%" style="background:#FFF0F0;padding:18px 20px;vertical-align:top"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#CC0000;margin-bottom:8px">Analyse Gauche</div><div style="font-size:13px;color:#333;line-height:1.6">' + data.analyseGauche + '</div></td>' +
    '<td width="50%" style="background:#EEF2FF;padding:18px 20px;vertical-align:top"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#1E3A6E;margin-bottom:8px">Analyse Droite</div><div style="font-size:13px;color:#333;line-height:1.6">' + data.analyseDroite + '</div></td>' +
    '</tr></table></td></tr>' +
    (data.exclusif ? '<tr><td style="background:#1A1A2E;padding:18px 28px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:gold;margin-bottom:8px">Angle exclusif Premium</div><div style="font-size:13px;color:#fff;line-height:1.6">' + data.exclusif + '</div></td></tr>' : '')
  ) : '';

  return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F6F3EE;font-family:Arial,sans-serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +
    '<tr><td style="background:#0D2B6E;border-radius:12px 12px 0 0;padding:22px 32px;text-align:center">' +
    (type === 'premium' ? '<div style="color:gold;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:5px">Edition Premium</div>' : '') +
    '<div style="color:#fff;font-size:20px;font-weight:700">🇫🇷 République</div>' +
    '<div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:4px;text-transform:uppercase;letter-spacing:1px">' + data.today + '</div>' +
    '</td></tr>' +
    '<tr><td style="background:#C1121F;padding:14px 32px"><div style="color:#fff;font-size:16px;font-weight:700">' + data.titre + '</div><div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px">' + data.intro + '</div></td></tr>' +
    '<tr><td style="background:#fff;padding:24px 32px"><table width="100%" cellpadding="0" cellspacing="0">' + newsRows + '</table></td></tr>' +
    premiumSection +
    '<tr><td style="background:#F6F3EE;padding:14px 32px;border-top:1px solid #E0D9CF"><div style="font-size:13px;color:#555;font-style:italic">' + data.conclusion + '</div></td></tr>' +
    '<tr><td style="background:#0D2B6E;border-radius:0 0 12px 12px;padding:14px 32px;text-align:center"><div style="color:rgba(255,255,255,0.4);font-size:10px">République · republique-politique.fr · <a href="*|UNSUB|*" style="color:rgba(255,255,255,0.5)">Se désabonner</a></div></td></tr>' +
    '</table></td></tr></table></body></html>';
}

async function sendToMailchimp(type, htmlContent, subject) {
  if (!MC_API_KEY || !MC_LIST_ID) { console.error('Mailchimp non configuré'); return false; }
  const recipients = type === 'premium'
    ? { list_id: MC_LIST_ID, segment_opts: { match: 'all', conditions: [{ condition_type: 'StaticSegment', field: 'static_segment', op: 'static_is', value: 'premium' }] } }
    : { list_id: MC_LIST_ID };

  const campaignResp = await fetch('https://' + MC_SERVER + '.api.mailchimp.com/3.0/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + Buffer.from('anystring:' + MC_API_KEY).toString('base64') },
    body: JSON.stringify({ type: 'regular', recipients, settings: { subject_line: subject, from_name: type === 'premium' ? 'République Premium' : 'République — Politique Française', reply_to: 'duroaymerick973@gmail.com', title: 'Newsletter ' + new Date().toISOString().split('T')[0] + ' ' + type } })
  });
  const campaign = await campaignResp.json();
  if (!campaign.id) { console.error('Erreur campagne:', campaign); return false; }

  await fetch('https://' + MC_SERVER + '.api.mailchimp.com/3.0/campaigns/' + campaign.id + '/content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + Buffer.from('anystring:' + MC_API_KEY).toString('base64') },
    body: JSON.stringify({ html: htmlContent })
  });

  const sendResp = await fetch('https://' + MC_SERVER + '.api.mailchimp.com/3.0/campaigns/' + campaign.id + '/actions/send', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + Buffer.from('anystring:' + MC_API_KEY).toString('base64') }
  });
  return sendResp.status === 204;
}

// ── Prévisualisation newsletter ───────────────────────────────────────
app.post('/newsletter/preview', async (req, res) => {
  const token = req.body?.token;
  if (token !== ADMIN_PASS) return res.status(401).json({ error: 'Non autorisé' });
  const type = req.body?.type || 'gratuit';
  try {
    const articles = await fetchNewsletterArticles();
    const data = await generateNewsletter(type, articles);
    res.json({ success: true, ...data, type });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Envoi newsletter ──────────────────────────────────────────────────
async function sendDailyNewsletter() {
  console.log('📧 Génération newsletter...');
  try {
    const articles = await fetchNewsletterArticles();
    // Newsletter gratuite
    const dataGratuit = await generateNewsletter('gratuit', articles);
    const htmlGratuit = buildEmailHTML('gratuit', dataGratuit);
    const subject = '🗞️ ' + dataGratuit.titre + ' — ' + new Date().toLocaleDateString('fr-FR', {day:'numeric',month:'long'});
    const ok = await sendToMailchimp('gratuit', htmlGratuit, subject);
    if (ok) {
      console.log('✅ Newsletter gratuite envoyée !');
      // Newsletter premium
      const dataPremium = await generateNewsletter('premium', articles);
      const htmlPremium = buildEmailHTML('premium', dataPremium);
      const subjectPremium = '⭐ [Premium] ' + dataPremium.titre + ' — ' + new Date().toLocaleDateString('fr-FR', {day:'numeric',month:'long'});
      const okPremium = await sendToMailchimp('premium', htmlPremium, subjectPremium);
      if (okPremium) console.log('✅ Newsletter premium envoyée !');
    }
  } catch(e) { console.error('❌ Erreur newsletter:', e.message); }
}

app.post('/newsletter/send', async (req, res) => {
  const token = req.body?.token || req.query?.token;
  if (token !== NL_TOKEN && token !== ADMIN_PASS) return res.status(403).json({ error: 'Token invalide' });
  res.json({ message: 'Envoi en cours...' });
  sendDailyNewsletter();
});

app.get('/newsletter/status', (req, res) => {
  const d = new Date(); d.setUTCHours(6,0,0,0);
  if (d <= new Date()) d.setUTCDate(d.getUTCDate()+1);
  res.json({ status: 'actif', heure: '7h00 Paris', prochainEnvoi: d.toLocaleString('fr-FR') });
});

// ── Page ADMIN ────────────────────────────────────────────────────────
app.get('/admin', async (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_PASS) return res.status(401).send('Accès refusé. Ajoutez ?token=VOTRE_MOT_DE_PASSE');

  let mcStats = { total: 0, premium: 0 };
  let stripeStats = { subscribers: 0, mrr: 0 };

  try {
    if (MC_API_KEY && MC_LIST_ID) {
      const r = await fetch('https://' + MC_SERVER + '.api.mailchimp.com/3.0/lists/' + MC_LIST_ID, {
        headers: { 'Authorization': 'Basic ' + Buffer.from('anystring:' + MC_API_KEY).toString('base64') }
      });
      const d = await r.json();
      mcStats.total = d.stats?.member_count || 0;
    }
  } catch(e) {}

  try {
    if (STRIPE_KEY) {
      const r = await fetch('https://api.stripe.com/v1/subscriptions?status=active&limit=100', {
        headers: { 'Authorization': 'Bearer ' + STRIPE_KEY }
      });
      const d = await r.json();
      stripeStats.subscribers = d.data?.length || 0;
      stripeStats.mrr = +(stripeStats.subscribers * 2.99).toFixed(2);
    }
  } catch(e) {}

  res.send('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — République</title>' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Segoe UI",Arial,sans-serif;background:#0D1117;color:#E6EDF3;min-height:100vh}' +
    '.header{background:#161B22;border-bottom:1px solid #30363D;padding:1rem 2rem;display:flex;align-items:center;gap:1rem}' +
    '.header h1{font-size:1.2rem;font-weight:700;color:#fff}.badge{background:#238636;color:#fff;font-size:.65rem;padding:.2rem .6rem;border-radius:50px;font-weight:700}' +
    '.main{padding:2rem;max-width:1200px;margin:0 auto}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:2rem}' +
    '.stat{background:#161B22;border:1px solid #30363D;border-radius:12px;padding:1.2rem}' +
    '.stat-label{font-size:.72rem;color:#8B949E;text-transform:uppercase;letter-spacing:.5px;margin-bottom:.4rem}' +
    '.stat-value{font-size:2rem;font-weight:700}.stat-sub{font-size:.75rem;color:#8B949E;margin-top:.2rem}' +
    '.stat.green .stat-value{color:#3FB950}.stat.gold .stat-value{color:gold}.stat.blue .stat-value{color:#58A6FF}' +
    '.card{background:#161B22;border:1px solid #30363D;border-radius:12px;padding:1.4rem;margin-bottom:1.2rem}' +
    '.card h2{font-size:1rem;font-weight:600;margin-bottom:1rem;color:#fff}' +
    '.btn{padding:.6rem 1.2rem;border-radius:8px;border:none;font-size:.85rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}' +
    '.btn-green{background:#238636;color:#fff}.btn-blue{background:#1F6FEB;color:#fff}.btn-gray{background:#21262D;color:#8B949E;border:1px solid #30363D}' +
    '.resp{margin-top:.7rem;padding:.6rem .9rem;border-radius:8px;font-size:.82rem;display:none}' +
    '.resp.ok{background:#0D1117;border:1px solid #238636;color:#3FB950}.resp.err{background:#0D1117;border:1px solid #DA3633;color:#F85149}' +
    '#preview-zone{display:none;margin-top:1.2rem}' +
    '.preview-header{background:#21262D;padding:.8rem 1rem;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between;border:1px solid #30363D}' +
    '#preview-content{background:#fff;max-height:600px;overflow-y:auto;border:1px solid #30363D;border-top:none;border-radius:0 0 10px 10px}' +
    '.rss-item{display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid #21262D;font-size:.83rem}' +
    '.rss-item:last-child{border-bottom:none}.toggle{width:36px;height:20px;background:#30363D;border-radius:50px;position:relative;cursor:pointer;transition:background .2s;flex-shrink:0}' +
    '.toggle.on{background:#238636}.toggle::after{content:"";position:absolute;width:14px;height:14px;background:#fff;border-radius:50%;top:3px;left:3px;transition:left .2s}' +
    '.toggle.on::after{left:19px}</style></head><body>' +
    '<div class="header"><div>🇫🇷</div><h1>République — Admin</h1><span class="badge">PRIVÉ</span></div>' +
    '<div class="main">' +
    '<div class="grid">' +
    '<div class="stat green"><div class="stat-label">Abonnés total</div><div class="stat-value">' + mcStats.total + '</div><div class="stat-sub">Mailchimp</div></div>' +
    '<div class="stat gold"><div class="stat-label">Abonnés Premium</div><div class="stat-value">' + stripeStats.subscribers + '</div><div class="stat-sub">' + stripeStats.mrr + '€/mois</div></div>' +
    '<div class="stat blue"><div class="stat-label">Abonnés Gratuits</div><div class="stat-value">' + (mcStats.total - stripeStats.subscribers) + '</div><div class="stat-sub">Newsletter quotidienne</div></div>' +
    '<div class="stat gold"><div class="stat-label">Revenus Stripe</div><div class="stat-value">' + stripeStats.mrr + '€</div><div class="stat-sub">MRR mensuel</div></div>' +
    '</div>' +
    '<div class="card"><h2>📧 Newsletter</h2>' +
    '<div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:.8rem">' +
    '<button class="btn btn-green" onclick="previewNL(\'gratuit\')">👁️ Aperçu gratuite</button>' +
    '<button class="btn btn-blue" onclick="previewNL(\'premium\')">👁️ Aperçu premium</button>' +
    '</div>' +
    '<div id="nl-resp" class="resp"></div>' +
    '<div id="preview-zone">' +
    '<div class="preview-header"><span id="preview-title" style="font-size:.85rem;font-weight:600;color:#fff">Aperçu</span>' +
    '<div style="display:flex;gap:.5rem"><button class="btn btn-green" id="send-btn" onclick="confirmSend()" style="padding:.38rem .85rem;font-size:.78rem">✅ Envoyer</button>' +
    '<button class="btn btn-gray" onclick="closePreview()" style="padding:.38rem .85rem;font-size:.78rem">✕</button></div></div>' +
    '<div id="preview-content"></div></div></div>' +
    '<div class="card"><h2>📡 Sources RSS actives (44)</h2>' +
    ['Le Monde|centre|#0066CC','Le Figaro|droite|#1E3A6E','Libération|gauche|#CC0000','France Info|public|#0891B2','BFM TV|public|#DC2626','Mediapart|gauche|#009966','Les Échos|eco|#1D4ED8','Le Parisien|régional|#003399','Ouest France|régional|#005A9C','Reporterre|alternatif|#2D6A4F','Blast|alternatif|#E63946','Guyane 1ère|outre-mer|#009900','Outre-mer 1ère|outre-mer|#0066CC','TV5 Monde|public|#003366'].map(function(s) {
      const parts = s.split('|');
      return '<div class="rss-item"><span style="font-weight:500">' + parts[0] + '</span><span style="font-size:.65rem;padding:.15rem .45rem;border-radius:50px;background:' + parts[2] + '22;color:' + parts[2] + ';font-weight:700">' + parts[1] + '</span><div class="toggle on" onclick="this.classList.toggle(\'on\')" title="Activer/désactiver"></div></div>';
    }).join('') +
    '<div style="color:#8B949E;font-size:.75rem;margin-top:.7rem;font-style:italic">+ 30 autres sources actives</div></div>' +
    '</div>' +
    '<script>' +
    'let currentType="gratuit";' +
    'async function previewNL(type){' +
    'currentType=type;' +
    'const resp=document.getElementById("nl-resp");' +
    'const zone=document.getElementById("preview-zone");' +
    'resp.className="resp ok";resp.textContent="⏳ Génération en cours (20-30 sec)...";resp.style.display="block";zone.style.display="none";' +
    'try{' +
    'const r=await fetch("/newsletter/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:"' + ADMIN_PASS + '",type})});' +
    'const d=await r.json();' +
    'if(!d.success)throw new Error(d.error);' +
    'document.getElementById("preview-title").textContent=(type==="premium"?"⭐ Premium — ":"📧 Gratuite — ")+d.titre;' +
    'const newsHTML=d.news.map(function(n,i){return "<div style=\'padding:11px 0;border-bottom:1px solid #E0D9CF;display:flex;gap:10px\'><span style=\'background:#0D2B6E;color:#fff;font-weight:700;font-size:11px;padding:2px 7px;border-radius:50px;flex-shrink:0;margin-top:2px\'>"+(i+1)+"</span><div><div style=\'font-weight:700;font-size:14px;color:#1A1A1A;margin-bottom:4px\'>"+n.titre+"</div><div style=\'font-size:12px;color:#444;line-height:1.6\'>"+n.desc+"</div></div></div>";}).join("");' +
    'const premExtra=type==="premium"&&d.analyseGauche?"<table width=\'100%\' cellpadding=\'0\' cellspacing=\'0\'><tr><td width=\'50%\' style=\'background:#FFF0F0;padding:14px 18px;vertical-align:top\'><div style=\'font-size:10px;font-weight:700;text-transform:uppercase;color:#CC0000;margin-bottom:6px\'>Analyse Gauche</div><div style=\'font-size:12px;color:#333;line-height:1.5\'>"+d.analyseGauche+"</div></td><td width=\'50%\' style=\'background:#EEF2FF;padding:14px 18px;vertical-align:top\'><div style=\'font-size:10px;font-weight:700;text-transform:uppercase;color:#1E3A6E;margin-bottom:6px\'>Analyse Droite</div><div style=\'font-size:12px;color:#333;line-height:1.5\'>"+d.analyseDroite+"</div></td></tr></table>"+(d.exclusif?"<div style=\'background:#1A1A2E;padding:14px 20px\'><div style=\'font-size:10px;font-weight:700;text-transform:uppercase;color:gold;margin-bottom:6px\'>Angle exclusif Premium</div><div style=\'font-size:12px;color:#fff;line-height:1.5\'>"+d.exclusif+"</div></div>":""):"";' +
    'document.getElementById("preview-content").innerHTML="<div style=\'font-family:Arial,sans-serif\'><div style=\'background:#0D2B6E;padding:16px 24px;text-align:center\'>"+(type==="premium"?"<div style=\'color:gold;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px\'>Edition Premium</div>":"")+"<div style=\'color:#fff;font-size:18px;font-weight:700\'>🇫🇷 République</div><div style=\'color:rgba(255,255,255,0.5);font-size:11px;margin-top:3px\'>"+d.today+"</div></div><div style=\'background:#C1121F;padding:13px 24px\'><div style=\'color:#fff;font-size:15px;font-weight:700\'>"+d.titre+"</div><div style=\'color:rgba(255,255,255,0.85);font-size:12px;margin-top:4px\'>"+d.intro+"</div></div><div style=\'background:#fff;padding:18px 24px\'>"+newsHTML+"</div>"+premExtra+"<div style=\'background:#F6F3EE;padding:12px 24px;border-top:1px solid #E0D9CF\'><div style=\'font-size:12px;color:#666;font-style:italic\'>"+d.conclusion+"</div></div></div>";' +
    'zone.style.display="block";resp.textContent="✅ Aperçu prêt — vérifiez avant d\'envoyer !";zone.scrollIntoView({behavior:"smooth",block:"start"});' +
    '}catch(e){resp.className="resp err";resp.textContent="❌ Erreur : "+e.message;}' +
    '}' +
    'function closePreview(){document.getElementById("preview-zone").style.display="none";}' +
    'async function confirmSend(){' +
    'const btn=document.getElementById("send-btn");const resp=document.getElementById("nl-resp");' +
    'btn.disabled=true;btn.textContent="Envoi...";' +
    'try{const r=await fetch("/newsletter/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:"' + ADMIN_PASS + '"})});' +
    'const d=await r.json();resp.className="resp ok";resp.textContent="✅ Newsletter envoyée !";resp.style.display="block";document.getElementById("preview-zone").style.display="none";}' +
    'catch(e){resp.className="resp err";resp.textContent="❌ "+e.message;resp.style.display="block";}' +
    'btn.disabled=false;btn.textContent="✅ Envoyer";}' +
    '</script></body></html>');
});

// ── Infos politiciens via Wikipedia ──────────────────────────────────
const wikiCache = {}; // Cache 1h pour éviter trop de requêtes

app.get('/wiki-info', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'Nom manquant' });

  // Vérifier le cache (1 heure)
  const cacheKey = name.toLowerCase();
  const now = Date.now();
  if (wikiCache[cacheKey] && (now - wikiCache[cacheKey].ts) < 3600000) {
    return res.json(wikiCache[cacheKey].data);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const encodedName = encodeURIComponent(name.replace(/ /g, '_'));
    const url = 'https://fr.wikipedia.org/api/rest_v1/page/summary/' + encodedName;
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'RepubliquePolitique/1.0 (republique-politique.fr)' }
    });
    clearTimeout(timer);

    if (!r.ok) return res.status(404).json({ error: 'Non trouvé' });

    const data = await r.json();
    const result = {
      titre: data.title || name,
      description: data.description || '',
      extrait: (data.extract || '').substring(0, 300),
      url: data.content_urls?.desktop?.page || ''
    };

    // Mettre en cache
    wikiCache[cacheKey] = { data: result, ts: now };
    res.json(result);
  } catch(e) {
    clearTimeout(timer);
    res.status(500).json({ error: e.message });
  }
});

// ── Planification newsletter à 7h ─────────────────────────────────────
function scheduleNewsletter() {
  const now = new Date();
  const next = new Date(); next.setUTCHours(6,0,0,0);
  if (next <= now) next.setUTCDate(next.getUTCDate()+1);
  const delay = next - now;
  console.log('⏰ Prochaine newsletter dans ' + Math.round(delay/60000) + ' minutes');
  setTimeout(function() {
    sendDailyNewsletter();
    setInterval(sendDailyNewsletter, 24*60*60*1000);
  }, delay);
}

app.listen(PORT, () => {
  console.log('\n✅ Serveur lancé sur le port ' + PORT);
  console.log('🤖 IA Recherche : Claude Sonnet');
  console.log('⚖️  IA Comparaison : Claude Haiku');
  console.log('📧 Newsletter automatique à 7h\n');
  scheduleNewsletter();
});
