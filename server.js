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
// ── NEWSLETTER PREMIUM ───────────────────────────────────────────────
async function sendPremiumNewsletter(articles, tops) {
  if (!MC_API_KEY || !MC_LIST_ID) return;
  try {
    // Générer contenu premium avec Claude Sonnet (plus intelligent)
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: `Tu es un analyste politique français expert, neutre et rigoureux. Génère une newsletter premium détaillée.
Format exact (sans markdown, sans #, sans *) :
TITRE: [titre accrocheur]
INTRO: [2 phrases d'accroche percutantes]
NEWS1: [titre] | [2-3 phrases d'analyse approfondie]
NEWS2: [titre] | [2-3 phrases d'analyse approfondie]
NEWS3: [titre] | [2-3 phrases d'analyse approfondie]
NEWS4: [titre] | [2-3 phrases d'analyse approfondie]
NEWS5: [titre] | [2-3 phrases d'analyse approfondie]
NEWS6: [titre] | [2-3 phrases d'analyse approfondie]
NEWS7: [titre] | [2-3 phrases d'analyse approfondie]
ANALYSE_GAUCHE: [Comment la presse de gauche traite l'actu du jour - 3 phrases]
ANALYSE_DROITE: [Comment la presse de droite traite l'actu du jour - 3 phrases]
EXCLUSIF: [Un angle ou fait que les médias mainstream n'ont pas mis en avant - 2 phrases]
CONCLUSION: [1 phrase de clôture]`,
        messages: [{ role: 'user', content: `Articles du jour :
${tops}

Génère la newsletter premium.` }]
      })
    });
    const aiData = await aiResp.json();
    const aiText = aiData.content?.[0]?.text || '';

    const getField = (key) => {
      const match = aiText.match(new RegExp(`${key}:\s*(.+)`));
      return match ? match[1].trim() : '';
    };
    const titre = getField('TITRE') || 'Analyse politique du jour';
    const intro = getField('INTRO') || '';
    const news = [1,2,3,4,5,6,7].map(i => {
      const line = getField(`NEWS${i}`);
      if (!line) return null;
      const [t, desc] = line.split('|').map(s => s.trim());
      return { titre: t, desc: desc || '' };
    }).filter(Boolean);
    const analyseGauche = getField('ANALYSE_GAUCHE') || '';
    const analyseDroite = getField('ANALYSE_DROITE') || '';
    const exclusif = getField('EXCLUSIF') || '';
    const conclusion = getField('CONCLUSION') || '';

    const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

    const newsHTML = news.map((n, i) => `
      <tr><td style="padding:14px 0;border-bottom:1px solid #E0D9CF">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <span style="background:#0D2B6E;color:#fff;font-weight:700;font-size:11px;padding:2px 8px;border-radius:50px;white-space:nowrap;margin-top:2px">${i+1}</span>
          <div>
            <div style="font-weight:700;font-size:15px;color:#1A1A1A;margin-bottom:5px">${n.titre}</div>
            <div style="font-size:13px;color:#444;line-height:1.6">${n.desc}</div>
          </div>
        </div>
      </td></tr>`).join('');

    const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F3EE;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:20px 10px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- EN-TÊTE PREMIUM -->
  <tr><td style="background:linear-gradient(135deg,#0D2B6E,#1A3F8F);border-radius:12px 12px 0 0;padding:24px 32px;text-align:center">
    <div style="color:gold;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px">⭐ Édition Premium</div>
    <div style="color:#fff;font-size:22px;font-weight:900">🇫🇷 République</div>
    <div style="color:rgba(255,255,255,0.55);font-size:11px;margin-top:4px;text-transform:uppercase;letter-spacing:1px">Analyse politique approfondie · ${today}</div>
  </td></tr>

  <!-- TITRE -->
  <tr><td style="background:#C1121F;padding:16px 32px">
    <div style="color:#fff;font-size:17px;font-weight:700">${titre}</div>
    <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:5px;line-height:1.5">${intro}</div>
  </td></tr>

  <!-- ACTUALITÉS -->
  <tr><td style="background:#fff;padding:24px 32px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:10px">Analyse des ${news.length} actualités du jour</div>
    <table width="100%" cellpadding="0" cellspacing="0">${newsHTML}</table>
  </td></tr>

  <!-- ANALYSE GAUCHE/DROITE -->
  <tr><td style="padding:0 0 0 0">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50%" style="background:#FFF0F0;padding:18px 20px;vertical-align:top">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#CC0000;margin-bottom:8px">◀ Analyse Gauche</div>
          <div style="font-size:13px;color:#333;line-height:1.6">${analyseGauche}</div>
        </td>
        <td width="50%" style="background:#EEF2FF;padding:18px 20px;vertical-align:top">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#1E3A6E;margin-bottom:8px">▶ Analyse Droite</div>
          <div style="font-size:13px;color:#333;line-height:1.6">${analyseDroite}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- EXCLUSIF -->
  <tr><td style="background:#1A1A2E;padding:20px 32px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:gold;margin-bottom:8px">⭐ Angle exclusif Premium</div>
    <div style="font-size:14px;color:#fff;line-height:1.6">${exclusif}</div>
  </td></tr>

  <!-- CONCLUSION -->
  <tr><td style="background:#F6F3EE;padding:16px 32px;border-top:1px solid #E0D9CF">
    <div style="font-size:13px;color:#555;font-style:italic">${conclusion}</div>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#0D2B6E;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center">
    <div style="color:rgba(255,255,255,0.5);font-size:11px">
      République Premium · <a href="https://republique-politique.fr" style="color:gold">republique-politique.fr</a><br>
      <a href="*|UNSUB|*" style="color:rgba(255,255,255,0.4);font-size:10px">Se désabonner</a>
    </div>
  </td></tr>

</table></td></tr></table>
</body></html>`;

    // Créer et envoyer la campagne premium (segmentée sur le tag "premium")
    const campaignResp = await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}` },
      body: JSON.stringify({
        type: 'regular',
        recipients: {
          list_id: MC_LIST_ID,
          segment_opts: {
            match: 'all',
            conditions: [{ condition_type: 'StaticSegment', field: 'static_segment', op: 'static_is', value: 'premium' }]
          }
        },
        settings: {
          subject_line: `⭐ [Premium] ${titre} — ${new Date().toLocaleDateString('fr-FR', {day:'numeric',month:'long'})}`,
          from_name: 'République Premium',
          reply_to: 'duroaymerick973@gmail.com',
          title: `Newsletter Premium ${new Date().toISOString().split('T')[0]}`
        }
      })
    });
    const campaign = await campaignResp.json();
    if (!campaign.id) { console.error('❌ Erreur campagne premium:', campaign); return; }

    await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/campaigns/${campaign.id}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}` },
      body: JSON.stringify({ html: htmlContent })
    });

    const sendResp = await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/campaigns/${campaign.id}/actions/send`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}` }
    });

    if (sendResp.status === 204) {
      console.log('✅ Newsletter premium envoyée !');
    } else {
      const err = await sendResp.json();
      console.error('❌ Erreur envoi premium:', err);
    }
  } catch(e) {
    console.error('❌ Erreur newsletter premium:', e.message);
  }
}

async function sendDailyNewsletter() {
  console.log('📧 Génération newsletter quotidienne...');
  try {
    // 1. Récupérer les derniers articles RSS
    const FEEDS = [
      // Gauche
      'https://www.lemonde.fr/politique/rss_full.xml',
      'https://www.liberation.fr/arc/outboundfeeds/rss-all/',
      'https://www.humanite.fr/rss.xml',
      'https://www.mediapart.fr/articles/feed',
      'https://www.nouvelobs.com/rss.xml',
      'https://reporterre.net/spip.php?page=backend',
      // Centre
      'https://www.lexpress.fr/arc/outboundfeeds/rss/politique/',
      'https://www.lepoint.fr/politique/rss.xml',
      'https://www.marianne.net/rss.xml',
      'https://www.lopinion.fr/feed',
      // Droite
      'https://www.lefigaro.fr/rss/figaro_politique.xml',
      'https://www.valeursactuelles.com/feed/',
      'https://www.causeur.fr/feed',
      // Public / Agences
      'https://www.francetvinfo.fr/politique.rss',
      'https://www.france24.com/fr/france/rss',
      'https://www.rfi.fr/fr/france/rss',
      'https://www.publicsenat.fr/rss/politique.xml',
      'https://www.bfmtv.com/rss/news-24-7/',
      'https://information.tv5monde.com/rss-france.xml',
      // Eco
      'https://www.lesechos.fr/rss/rss_politique.xml',
      'https://www.challenges.fr/rss.xml',
      // Régional
      'https://feeds.leparisien.fr/leparisien/rss',
      'https://www.ouest-france.fr/rss-en-continu.xml',
      // Outre-mer
      'https://la1ere.francetvinfo.fr/rss',
      'https://la1ere.francetvinfo.fr/guyane/rss',
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
      console.log(`✅ Newsletter gratuite envoyée ! Sujet : ${titre}`);
      // Envoyer aussi la version premium
      await sendPremiumNewsletter(articles, tops);
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

// ── ROUTE PRÉVISUALISATION NEWSLETTER ────────────────────────────────
app.post('/newsletter/preview', async (req, res) => {
  const token = req.body?.token;
  if (token !== (process.env.ADMIN_PASSWORD || 'republique-admin-2026')) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  const type = req.body?.type || 'gratuit';
  console.log(`👁️ Prévisualisation newsletter ${type}...`);
  try {
    // Récupérer articles RSS
    const FEEDS_PREVIEW = [
      'https://www.lemonde.fr/politique/rss_full.xml',
      'https://www.lefigaro.fr/rss/figaro_politique.xml',
      'https://www.francetvinfo.fr/politique.rss',
      'https://www.liberation.fr/arc/outboundfeeds/rss-all/',
      'https://www.bfmtv.com/rss/news-24-7/',
    ];
    const articles = [];
    for (const url of FEEDS_PREVIEW) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        clearTimeout(t);
        const txt = await r.text();
        const items = txt.match(/<item>[\s\S]*?<\/item>/g) || [];
        items.slice(0, 4).forEach(item => {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1] || '';
          if (title.length > 10) articles.push(title.trim());
        });
      } catch {}
    }
    const tops = articles.slice(0, 20).map((t, i) => `${i+1}. ${t}`).join('
');

    // Générer avec Claude
    const model = type === 'premium' ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001';
    const system = type === 'premium'
      ? `Tu es un analyste politique français expert. Génère une newsletter premium. Format (sans markdown) :
TITRE: [titre]
INTRO: [2 phrases]
NEWS1: [titre] | [2-3 phrases analyse]
NEWS2: [titre] | [2-3 phrases analyse]
NEWS3: [titre] | [2-3 phrases analyse]
NEWS4: [titre] | [2-3 phrases analyse]
NEWS5: [titre] | [2-3 phrases analyse]
ANALYSE_GAUCHE: [3 phrases]
ANALYSE_DROITE: [3 phrases]
EXCLUSIF: [2 phrases angle exclusif]
CONCLUSION: [1 phrase]`
      : `Tu es un journaliste politique français neutre. Format (sans markdown) :
TITRE: [titre accrocheur]
INTRO: [1 phrase accroche]
NEWS1: [titre court] | [1 phrase explication]
NEWS2: [titre court] | [1 phrase explication]
NEWS3: [titre court] | [1 phrase explication]
NEWS4: [titre court] | [1 phrase explication]
NEWS5: [titre court] | [1 phrase explication]
CONCLUSION: [1 phrase]`;

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: type === 'premium' ? 1200 : 600, system, messages: [{ role: 'user', content: `Articles:
${tops}

Génère la newsletter.` }] })
    });
    const aiData = await aiResp.json();
    const aiText = aiData.content?.[0]?.text || '';

    const getField = (key) => { const m = aiText.match(new RegExp(`${key}:\s*(.+)`)); return m ? m[1].trim() : ''; };
    const titre = getField('TITRE') || 'Newsletter du jour';
    const intro = getField('INTRO') || '';
    const news = [1,2,3,4,5,6,7].map(i => {
      const line = getField(`NEWS${i}`); if (!line) return null;
      const [t, d] = line.split('|').map(s => s.trim());
      return { titre: t, desc: d || '' };
    }).filter(Boolean);
    const analyseGauche = getField('ANALYSE_GAUCHE') || '';
    const analyseDroite = getField('ANALYSE_DROITE') || '';
    const exclusif = getField('EXCLUSIF') || '';
    const conclusion = getField('CONCLUSION') || '';
    const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

    res.json({ success: true, type, titre, intro, news, analyseGauche, analyseDroite, exclusif, conclusion, today, rawText: aiText });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PAGE ADMIN ───────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'republique-admin-2026';

// Middleware auth admin
function adminAuth(req, res, next) {
  const token = req.query.token || req.headers['x-admin-token'];
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).send('Accès refusé. Ajoutez ?token=VOTRE_MOT_DE_PASSE');
  }
  next();
}

// Page admin HTML
app.get('/admin', adminAuth, async (req, res) => {
  const token = req.query.token;

  // Stats Mailchimp
  let mcStats = { total: 0, premium: 0, gratuit: 0 };
  let stripeStats = { mrr: 0, subscribers: 0 };

  try {
    if (MC_API_KEY && MC_LIST_ID) {
      const r = await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}`, {
        headers: { 'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}` }
      });
      const d = await r.json();
      mcStats.total = d.stats?.member_count || 0;

      // Tag premium
      const tagR = await fetch(`https://${MC_SERVER}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/tag-search?name=premium`, {
        headers: { 'Authorization': `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}` }
      });
      const tagD = await tagR.json();
      mcStats.premium = tagD.tags?.[0]?.member_count || 0;
      mcStats.gratuit = mcStats.total - mcStats.premium;
    }
  } catch(e) { console.error('MC stats error:', e.message); }

  try {
    if (STRIPE_SECRET) {
      const r = await fetch('https://api.stripe.com/v1/subscriptions?status=active&limit=100', {
        headers: { 'Authorization': `Bearer ${STRIPE_SECRET}` }
      });
      const d = await r.json();
      stripeStats.subscribers = d.data?.length || 0;
      stripeStats.mrr = stripeStats.subscribers * 2.99;
    }
  } catch(e) { console.error('Stripe stats error:', e.message); }

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — République</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;background:#0D1117;color:#E6EDF3;min-height:100vh}
.header{background:#161B22;border-bottom:1px solid #30363D;padding:1rem 2rem;display:flex;align-items:center;gap:1rem}
.header h1{font-size:1.2rem;font-weight:700;color:#fff}
.header span{background:#238636;color:#fff;font-size:.65rem;padding:.2rem .6rem;border-radius:50px;font-weight:700}
.main{padding:2rem;max-width:1200px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem;margin-bottom:2rem}
.stat{background:#161B22;border:1px solid #30363D;border-radius:12px;padding:1.2rem}
.stat-label{font-size:.72rem;color:#8B949E;text-transform:uppercase;letter-spacing:.5px;margin-bottom:.4rem}
.stat-value{font-size:2rem;font-weight:700;color:#fff}
.stat-sub{font-size:.75rem;color:#8B949E;margin-top:.2rem}
.stat.green .stat-value{color:#3FB950}
.stat.blue .stat-value{color:#58A6FF}
.stat.gold .stat-value{color:gold}
.card{background:#161B22;border:1px solid #30363D;border-radius:12px;padding:1.4rem;margin-bottom:1.2rem}
.card h2{font-size:1rem;font-weight:600;margin-bottom:1rem;color:#fff;display:flex;align-items:center;gap:.5rem}
.btn{padding:.6rem 1.2rem;border-radius:8px;border:none;font-size:.85rem;font-weight:600;cursor:pointer;transition:all .15s;font-family:inherit}
.btn-primary{background:#238636;color:#fff}.btn-primary:hover{background:#2EA043}
.btn-danger{background:#DA3633;color:#fff}.btn-danger:hover{background:#F85149}
.btn-blue{background:#1F6FEB;color:#fff}.btn-blue:hover{background:#388BFD}
.btn:disabled{opacity:.5;cursor:not-allowed}
.rss-item{display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid #21262D;font-size:.83rem}
.rss-item:last-child{border-bottom:none}
.rss-name{font-weight:500}
.rss-bord{font-size:.65rem;padding:.15rem .45rem;border-radius:50px;font-weight:700}
.toggle{width:36px;height:20px;background:#30363D;border-radius:50px;position:relative;cursor:pointer;transition:background .2s;flex-shrink:0}
.toggle.on{background:#238636}
.toggle::after{content:'';position:absolute;width:14px;height:14px;background:#fff;border-radius:50%;top:3px;left:3px;transition:left .2s}
.toggle.on::after{left:19px}
.response{margin-top:.7rem;padding:.6rem .9rem;border-radius:8px;font-size:.82rem;display:none}
.response.ok{background:#0D1117;border:1px solid #238636;color:#3FB950}
.response.err{background:#0D1117;border:1px solid #DA3633;color:#F85149}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{text-align:left;color:#8B949E;font-weight:500;font-size:.72rem;text-transform:uppercase;letter-spacing:.4px;padding:.5rem 0;border-bottom:1px solid #21262D}
td{padding:.55rem 0;border-bottom:1px solid #21262D;color:#C9D1D9}
</style>
</head>
<body>
<div class="header">
  <div>🇫🇷</div>
  <h1>République — Admin</h1>
  <span>PRIVÉ</span>
</div>

<div class="main">

  <!-- STATS -->
  <div class="grid">
    <div class="stat green">
      <div class="stat-label">Abonnés total</div>
      <div class="stat-value">${mcStats.total}</div>
      <div class="stat-sub">Mailchimp</div>
    </div>
    <div class="stat gold">
      <div class="stat-label">Abonnés Premium</div>
      <div class="stat-value">${mcStats.premium}</div>
      <div class="stat-sub">${(mcStats.premium * 2.99).toFixed(2)}€/mois</div>
    </div>
    <div class="stat blue">
      <div class="stat-label">Abonnés Gratuits</div>
      <div class="stat-value">${mcStats.gratuit}</div>
      <div class="stat-sub">Newsletter quotidienne</div>
    </div>
    <div class="stat gold">
      <div class="stat-label">Revenus Stripe</div>
      <div class="stat-value">${stripeStats.mrr.toFixed(2)}€</div>
      <div class="stat-sub">${stripeStats.subscribers} abonnements actifs</div>
    </div>
  </div>

  <!-- NEWSLETTER -->
  <div class="card">
    <h2>📧 Newsletter</h2>
    <div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem">
      <button class="btn btn-primary" onclick="previewNL('gratuit')">👁️ Prévisualiser gratuite</button>
      <button class="btn btn-blue" onclick="previewNL('premium')">👁️ Prévisualiser premium</button>
    </div>
    <div id="nl-response" class="response"></div>

    <!-- Zone de prévisualisation -->
    <div id="preview-zone" style="display:none;margin-top:1.2rem">
      <div style="border:1px solid #30363D;border-radius:10px;overflow:hidden">
        <div style="background:#21262D;padding:.8rem 1rem;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:.85rem;font-weight:600;color:#fff" id="preview-title">Aperçu</div>
          <div style="display:flex;gap:.6rem">
            <button class="btn btn-primary" id="send-btn" onclick="confirmSend()" style="padding:.4rem .9rem;font-size:.78rem">✅ Envoyer maintenant</button>
            <button class="btn" onclick="closePreview()" style="padding:.4rem .9rem;font-size:.78rem;background:#21262D;color:#8B949E;border:1px solid #30363D">✕ Annuler</button>
          </div>
        </div>
        <div id="preview-content" style="background:#fff;max-height:600px;overflow-y:auto"></div>
      </div>
    </div>
  </div>

  <!-- SOURCES RSS -->
  <div class="card">
    <h2>📡 Sources RSS (${44} sources)</h2>
    <div id="rss-list">
      ${[
        {name:'Le Monde', bord:'centre', color:'#0066CC'},
        {name:'Le Figaro', bord:'droite', color:'#1E3A6E'},
        {name:'Libération', bord:'gauche', color:'#CC0000'},
        {name:'France Info', bord:'public', color:'#0891B2'},
        {name:'BFM TV', bord:'public', color:'#DC2626'},
        {name:'Mediapart', bord:'gauche', color:'#009966'},
        {name:'Les Échos', bord:'eco', color:'#1D4ED8'},
        {name:'Le Parisien', bord:'régional', color:'#003399'},
        {name:'Ouest France', bord:'régional', color:'#005A9C'},
        {name:'Reporterre', bord:'gauche', color:'#2D6A4F'},
        {name:'Blast', bord:'gauche', color:'#E63946'},
        {name:'Guyane 1ère', bord:'outre-mer', color:'#009900'},
        {name:'Outre-mer 1ère', bord:'outre-mer', color:'#0066CC'},
        {name:'TV5 Monde', bord:'public', color:'#003366'},
      ].map(s => `
        <div class="rss-item">
          <span class="rss-name">${s.name}</span>
          <span class="rss-bord" style="background:${s.color}22;color:${s.color}">${s.bord}</span>
          <div class="toggle on" onclick="this.classList.toggle('on')" title="Activer/désactiver"></div>
        </div>`).join('')}
      <div style="color:#8B949E;font-size:.75rem;margin-top:.7rem;font-style:italic">+ 30 autres sources actives · Gestion avancée bientôt disponible</div>
    </div>
  </div>

  <!-- DERNIERS ARTICLES -->
  <div class="card">
    <h2>📰 Derniers articles (chargés en direct)</h2>
    <div id="articles-list">
      <div style="color:#8B949E;font-size:.83rem">Chargement...</div>
    </div>
  </div>

</div>

<script>
let currentPreviewType = 'gratuit';

async function previewNL(type) {
  currentPreviewType = type;
  const resp = document.getElementById('nl-response');
  const zone = document.getElementById('preview-zone');
  const content = document.getElementById('preview-content');
  const titleEl = document.getElementById('preview-title');

  resp.className = 'response ok';
  resp.textContent = '⏳ Génération de l\'aperçu en cours (15-30 secondes)...';
  resp.style.display = 'block';
  zone.style.display = 'none';

  try {
    const r = await fetch('/newsletter/preview', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ token: '${ADMIN_PASSWORD}', type })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    titleEl.textContent = (type === 'premium' ? '⭐ Premium' : '📧 Gratuite') + ' — ' + d.titre;

    // Construire l'aperçu HTML
    const newsHTML = d.news.map((n, i) => `
      <div style="padding:12px 0;border-bottom:1px solid #E0D9CF;display:flex;gap:10px">
        <span style="background:#0D2B6E;color:#fff;font-weight:700;font-size:11px;padding:2px 7px;border-radius:50px;flex-shrink:0;margin-top:2px">${i+1}</span>
        <div>
          <div style="font-weight:700;font-size:14px;color:#1A1A1A;margin-bottom:4px">${n.titre}</div>
          <div style="font-size:12px;color:#444;line-height:1.6">${n.desc}</div>
        </div>
      </div>`).join('');

    const premiumExtra = type === 'premium' && (d.analyseGauche || d.analyseDroite) ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:0">
        <tr>
          <td width="50%" style="background:#FFF0F0;padding:16px 20px;vertical-align:top">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#CC0000;margin-bottom:6px">◀ Analyse Gauche</div>
            <div style="font-size:12px;color:#333;line-height:1.6">${d.analyseGauche}</div>
          </td>
          <td width="50%" style="background:#EEF2FF;padding:16px 20px;vertical-align:top">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#1E3A6E;margin-bottom:6px">▶ Analyse Droite</div>
            <div style="font-size:12px;color:#333;line-height:1.6">${d.analyseDroite}</div>
          </td>
        </tr>
      </table>
      ${d.exclusif ? '<div style=\"background:#1A1A2E;padding:16px 24px\"><div style=\"font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:gold;margin-bottom:6px\">⭐ Angle exclusif Premium</div><div style=\"font-size:13px;color:#fff;line-height:1.6\">' + d.exclusif + '</div></div>' : ''}` : '';

    content.innerHTML = \`
      <div style="font-family:Arial,sans-serif">
        <div style="background:#0D2B6E;padding:18px 28px;text-align:center">
          ${type === 'premium' ? '<div style=\"color:gold;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px\">⭐ Edition Premium</div>' : ''}
          <div style="color:#fff;font-size:18px;font-weight:700">🇫🇷 République</div>
          <div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:3px;text-transform:uppercase">${d.today}</div>
        </div>
        <div style="background:#C1121F;padding:14px 28px">
          <div style="color:#fff;font-size:15px;font-weight:700">${d.titre}</div>
          <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:4px">${d.intro}</div>
        </div>
        <div style="background:#fff;padding:20px 28px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:10px">${d.news.length} actualités du jour</div>
          ${newsHTML}
        </div>
        ${premiumExtra}
        <div style="background:#F6F3EE;padding:12px 28px;border-top:1px solid #E0D9CF">
          <div style="font-size:12px;color:#777;font-style:italic">${d.conclusion}</div>
        </div>
        <div style="background:#0D2B6E;padding:12px 28px;text-align:center">
          <div style="color:rgba(255,255,255,0.4);font-size:10px">République · republique-politique.fr</div>
        </div>
      </div>\`;

    zone.style.display = 'block';
    resp.textContent = '✅ Aperçu généré ! Vérifiez avant d\'envoyer.';
    zone.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch(e) {
    resp.className = 'response err';
    resp.textContent = '❌ Erreur : ' + e.message;
  }
}

function closePreview() {
  document.getElementById('preview-zone').style.display = 'none';
}

async function confirmSend() {
  const btn = document.getElementById('send-btn');
  const resp = document.getElementById('nl-response');
  btn.disabled = true;
  btn.textContent = 'Envoi en cours...';
  try {
    const r = await fetch('/newsletter/send', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ token: '${ADMIN_PASSWORD}' })
    });
    const d = await r.json();
    resp.className = 'response ok';
    resp.textContent = '✅ Newsletter envoyée avec succès !';
    resp.style.display = 'block';
    document.getElementById('preview-zone').style.display = 'none';
  } catch(e) {
    resp.className = 'response err';
    resp.textContent = '❌ Erreur envoi : ' + e.message;
    resp.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = '✅ Envoyer maintenant';
}

// Charger les derniers articles
async function loadArticles() {
  const el = document.getElementById('articles-list');
  try {
    const r = await fetch('/rss?url=https://www.lemonde.fr/politique/rss_full.xml');
    const txt = await r.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(txt, 'application/xml');
    const items = [...xml.querySelectorAll('item')].slice(0, 8);
    el.innerHTML = '<table><thead><tr><th>Titre</th><th>Source</th><th>Date</th></tr></thead><tbody>' +
      items.map(i => {
        const title = i.querySelector('title')?.textContent || '';
        const date = new Date(i.querySelector('pubDate')?.textContent || '').toLocaleDateString('fr-FR', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
        return '<tr><td><a href="' + (i.querySelector('link')?.textContent||'#') + '" target="_blank" style="color:#58A6FF;text-decoration:none">' + title.substring(0,80) + '...</a></td><td style="color:#8B949E">Le Monde</td><td style="color:#8B949E;white-space:nowrap">' + date + '</td></tr>';
      }).join('') + '</tbody></table>';
  } catch(e) {
    el.innerHTML = '<div style="color:#8B949E;font-size:.83rem">Erreur de chargement</div>';
  }
}
loadArticles();
</script>
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
