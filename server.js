// server.js — République Politique Française
// Compatible Render.com (PORT auto) + usage local
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

// Mailchimp — variables d'environnement UNIQUEMENT (configurées sur Render)
const MC_API_KEY   = process.env.MAILCHIMP_API_KEY   || '';
const MC_LIST_ID   = process.env.MAILCHIMP_LIST_ID   || '';
const MC_SERVER    = MC_API_KEY ? MC_API_KEY.split('-')[1] : 'us10';

console.log(API_KEY ? '🔑 Clé Claude chargée.' : '[!] Pas de clé Claude.');
console.log(MC_API_KEY ? '📧 Clé Mailchimp chargée.' : '[!] Pas de clé Mailchimp.');

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

// ── Proxy images Wikipedia ────────────────────────────────────────────
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

// ── Route IA Recherche — Claude Sonnet ───────────────────────────────
app.post('/ai', async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'Clé API non configurée.' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: req.body.max_tokens || 600,
        system: req.body.system || 'Tu es un expert en politique française, neutre et objectif.',
        messages: req.body.messages
      })
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Route IA Comparaison — Claude Haiku ──────────────────────────────
app.post('/ai-compare', async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'Clé API non configurée.' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `Tu es un analyste politique français neutre et objectif. Rédige en 3-4 phrases simples une synthèse neutre. IMPORTANT : Pas de markdown, pas de #, pas de *, texte simple uniquement.`,
        messages: req.body.messages
      })
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── NEWSLETTER AUTOMATIQUE ────────────────────────────────────────────
// Fonction principale : génère et envoie la newsletter via Mailchimp
async function sendDailyNewsletter() {
  console.log('📧 Génération newsletter quotidienne...');
  try {
    // 1. Récupérer les derniers articles RSS
    const FEEDS = [
      'https://www.lemonde.fr/politique/rss_full.xml',
      'https://www.lefigaro.fr/rss/figaro_politique.xml',
      'https://www.francetvinfo.fr/politique.rss',
      'https://www.liberation.fr/arc/outboundfeeds/rss-all/',
      'https://www.lesechos.fr/rss/rss_politique.xml',
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
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/))?.[1] || '';
          const link  = (item.match(/<link>(.*?)<\/link>/))?.[1] || '';
          if (title.length > 10) articles.push({ title: title.trim(), link: link.trim(), source: url });
        });
      } catch {}
    }

    const tops = articles.slice(0, 20).map((a, i) => `${i+1}. ${a.title}`).join('\n');

    // 2. Générer le contenu avec Claude Haiku (moins cher)
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: `Tu es un journaliste politique français neutre. Génère une newsletter quotidienne courte et percutante.
Format exact attendu (sans markdown, sans #, sans *) :
TITRE: [titre accrocheur de la newsletter]
INTRO: [1 phrase d'accroche]
NEWS1: [titre court] | [1 phrase d'explication]
NEWS2: [titre court] | [1 phrase d'explication]
NEWS3: [titre court] | [1 phrase d'explication]
NEWS4: [titre court] | [1 phrase d'explication]
NEWS5: [titre court] | [1 phrase d'explication]
CONCLUSION: [1 phrase de clôture neutre]`,
        messages: [{ role: 'user', content: `Articles du jour :\n${tops}\n\nGénère la newsletter.` }]
      })
    });
    const aiData = await aiResp.json();
    const aiText = aiData.content?.[0]?.text || '';

    // 3. Parser le contenu généré
    const getField = (key) => {
      const match = aiText.match(new RegExp(`${key}:\\s*(.+)`));
      return match ? match[1].trim() : '';
    };
    const titre      = getField('TITRE')  || 'Revue de presse politique du jour';
    const intro      = getField('INTRO')  || 'Voici les actualités politiques du jour.';
    const news       = [1,2,3,4,5].map(i => {
      const line = getField(`NEWS${i}`);
      if (!line) return null;
      const [t, desc] = line.split('|').map(s => s.trim());
      return { titre: t, desc: desc || '' };
    }).filter(Boolean);
    const conclusion = getField('CONCLUSION') || 'Bonne journée et à demain pour la prochaine édition.';

    const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

    // 4. Construire le HTML de l'email
    const newsHTML = news.map((n, i) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #E0D9CF">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <span style="background:#0D2B6E;color:#fff;font-weight:700;font-size:12px;padding:2px 8px;border-radius:50px;white-space:nowrap;margin-top:2px">${i+1}</span>
            <div>
              <div style="font-weight:700;font-size:15px;color:#1A1A1A;margin-bottom:4px">${n.titre}</div>
              <div style="font-size:13px;color:#666;line-height:1.5">${n.desc}</div>
            </div>
          </div>
        </td>
      </tr>`).join('');

    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F3EE;font-family:'DM Sans',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:20px 10px">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

        <!-- EN-TÊTE -->
        <tr><td style="background:#0D2B6E;border-radius:12px 12px 0 0;padding:24px 32px;text-align:center">
          <div style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">🇫🇷 République</div>
          <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:4px;text-transform:uppercase;letter-spacing:1px">Revue de presse politique · ${today}</div>
        </td></tr>

        <!-- INTRO -->
        <tr><td style="background:#C1121F;padding:14px 32px">
          <div style="color:#fff;font-size:16px;font-weight:700">${titre}</div>
          <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px">${intro}</div>
        </td></tr>

        <!-- CONTENU -->
        <tr><td style="background:#fff;padding:24px 32px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:8px">Les 5 actualités du jour</div>
          <table width="100%" cellpadding="0" cellspacing="0">${newsHTML}</table>
        </td></tr>

        <!-- CONCLUSION -->
        <tr><td style="background:#F6F3EE;padding:16px 32px;border-top:1px solid #E0D9CF">
          <div style="font-size:13px;color:#555;font-style:italic">${conclusion}</div>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#0D2B6E;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center">
          <div style="color:rgba(255,255,255,0.5);font-size:11px">
            République · <a href="https://republique-politique.fr" style="color:rgba(255,255,255,0.7)">republique-politique.fr</a><br>
            <a href="*|UNSUB|*" style="color:rgba(255,255,255,0.4);font-size:10px">Se désabonner</a>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // 5. Créer la campagne Mailchimp
    const campaignResp = await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}`
      },
      body: JSON.stringify({
        type: 'regular',
        recipients: { list_id: MC_LIST_ID },
        settings: {
          subject_line: `🗞️ ${titre} — ${new Date().toLocaleDateString('fr-FR', {day:'numeric',month:'long'})}`,
          from_name: 'République — Politique Française',
          reply_to: 'duroaymerick973@gmail.com',
          title: `Newsletter ${new Date().toISOString().split('T')[0]}`
        }
      })
    });
    const campaign = await campaignResp.json();
    if (!campaign.id) { console.error('❌ Erreur création campagne:', campaign); return; }

    // 6. Ajouter le contenu HTML à la campagne
    await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/campaigns/${campaign.id}/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}`
      },
      body: JSON.stringify({ html: htmlContent })
    });

    // 7. Envoyer la campagne
    const sendResp = await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/campaigns/${campaign.id}/actions/send`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}` }
    });

    if (sendResp.status === 204) {
      console.log(`✅ Newsletter envoyée ! Sujet : ${titre}`);
    } else {
      const err = await sendResp.json();
      console.error('❌ Erreur envoi:', err);
    }

  } catch(e) {
    console.error('❌ Erreur newsletter:', e.message);
  }
}

// ── PLANIFICATION QUOTIDIENNE à 7h00 (heure Paris) ───────────────────
// Render est en UTC — Paris = UTC+1 (UTC+2 en été) → on envoie à 6h UTC
function scheduleDailyNewsletter() {
  const now = new Date();
  const next7am = new Date();
  next7am.setUTCHours(6, 0, 0, 0); // 6h UTC = 7h Paris heure d'hiver
  if (next7am <= now) next7am.setUTCDate(next7am.getUTCDate() + 1);
  const delay = next7am - now;
  console.log(`⏰ Prochaine newsletter dans ${Math.round(delay/1000/60)} minutes`);
  setTimeout(() => {
    sendDailyNewsletter();
    setInterval(sendDailyNewsletter, 24 * 60 * 60 * 1000); // puis toutes les 24h
  }, delay);
}

// ── Route manuelle pour tester l'envoi ───────────────────────────────
app.post('/newsletter/send', async (req, res) => {
  // Sécurité : token requis pour éviter les abus
  const token = req.body?.token || req.query?.token;
  if (token !== process.env.NEWSLETTER_TOKEN && token !== 'republique2026') {
    return res.status(403).json({ error: 'Token invalide' });
  }
  res.json({ message: 'Envoi en cours...' });
  sendDailyNewsletter();
});

// ── Route statut newsletter ───────────────────────────────────────────
app.get('/newsletter/status', (req, res) => {
  res.json({
    status: 'actif',
    mailchimp: !!MC_API_KEY,
    listId: MC_LIST_ID,
    heure: '7h00 Paris (6h UTC)',
    prochainEnvoi: (() => {
      const d = new Date();
      d.setUTCHours(6,0,0,0);
      if (d <= new Date()) d.setUTCDate(d.getUTCDate()+1);
      return d.toLocaleString('fr-FR');
    })()
  });
});

// ── Route inscription newsletter gratuite ────────────────────────────
app.post('/newsletter/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email invalide' });
  if (!MC_API_KEY || !MC_LIST_ID) return res.status(503).json({ error: 'Mailchimp non configuré' });
  try {
    const r = await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}`
      },
      body: JSON.stringify({
        email_address: email,
        status: 'subscribed',
        tags: ['gratuit']
      })
    });
    const data = await r.json();
    if (r.status === 200 || r.status === 201) {
      res.json({ success: true, message: 'Inscrit avec succès !' });
    } else if (data.title === 'Member Exists') {
      res.json({ success: true, message: 'Vous êtes déjà inscrit !' });
    } else {
      res.status(400).json({ error: data.detail || 'Erreur inscription' });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STRIPE PAIEMENT ──────────────────────────────────────────────────
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE  = process.env.STRIPE_PRICE_ID   || ''; // ID du prix créé sur Stripe
const SITE_URL      = process.env.SITE_URL || 'https://republique-politique.fr';

// Route : créer une session de paiement Stripe Checkout
app.post('/stripe/checkout', async (req, res) => {
  if (!STRIPE_SECRET) return res.status(503).json({ error: 'Stripe non configuré.' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis.' });
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'customer_email': email,
        'line_items[0][price]': STRIPE_PRICE,
        'line_items[0][quantity]': '1',
        'success_url': `${SITE_URL}/premium-success?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${SITE_URL}/#apropos`,
        'locale': 'fr',
        'allow_promotion_codes': 'true',
        'subscription_data[metadata][source]': 'republique-politique.fr'
      })
    });
    const session = await r.json();
    if (session.url) {
      res.json({ url: session.url });
    } else {
      console.error('Stripe error:', session);
      res.status(500).json({ error: session.error?.message || 'Erreur Stripe' });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Route : webhook Stripe — appelé automatiquement après paiement réussi
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  let event;
  try {
    // Vérification basique sans SDK (on vérifie juste le type d'événement)
    event = JSON.parse(req.body);
  } catch(e) {
    return res.status(400).send('Webhook parse error');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    if (email && MC_API_KEY && MC_LIST_ID) {
      // Ajouter l'abonné à Mailchimp avec tag "premium"
      try {
        await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}`
          },
          body: JSON.stringify({
            email_address: email,
            status: 'subscribed',
            tags: ['premium'],
            merge_fields: { FNAME: 'Abonné Premium' }
          })
        });
        console.log(`✅ Nouvel abonné premium ajouté : ${email}`);
      } catch(e) {
        console.error('Erreur ajout Mailchimp:', e.message);
      }
    }
  }
  res.json({ received: true });
});

// Route : page de succès après paiement
app.get('/premium-success', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Abonnement confirmé — République</title>
<style>
  body{font-family:Arial,sans-serif;background:#0D2B6E;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{background:#fff;border-radius:20px;padding:3rem;text-align:center;max-width:480px;width:90%}
  h1{color:#0D2B6E;font-size:2rem;margin-bottom:.5rem}
  p{color:#555;line-height:1.7;margin-bottom:1.2rem}
  .badge{background:gold;color:#1A1A1A;font-weight:700;padding:.4rem 1.2rem;border-radius:50px;font-size:.9rem;display:inline-block;margin-bottom:1.2rem}
  .btn{background:#0D2B6E;color:#fff;padding:.8rem 2rem;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;margin-top:.5rem}
  .btn:hover{background:#1A3F8F}
</style>
</head>
<body>
  <div class="box">
    <div style="font-size:3rem">🎉</div>
    <h1>Bienvenue !</h1>
    <div class="badge">⭐ Abonné Premium</div>
    <p>Votre abonnement à la <strong>Newsletter République Premium</strong> est confirmé.<br>
    Vous recevrez votre première édition demain matin à 7h00.</p>
    <p style="font-size:.85rem;color:#888">Un email de confirmation vous a été envoyé.<br>Vous pouvez annuler à tout moment depuis Mailchimp.</p>
    <a href="https://republique-politique.fr" class="btn">Retour au site →</a>
  </div>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`\n✅ Serveur lancé sur le port ${PORT}`);
  console.log(`🤖 IA Recherche : Claude Sonnet (~0.01$/requête)`);
  console.log(`⚖️  IA Comparaison : Claude Haiku (~0.001$/requête)`);
  console.log(`📧 Newsletter : envoi automatique à 7h chaque matin\n`);
  scheduleDailyNewsletter();
});
