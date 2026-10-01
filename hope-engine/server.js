const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors({ origin: true }));
const PORT = process.env.PORT || 10000;
const sessions = new Map();

function stateFor(id){
  if(!sessions.has(id)) sessions.set(id, { results: [], cursor: 0, visited: new Set(), lastSearch: 0 });
  return sessions.get(id);
}
function clean(s){ return String(s || '').replace(/\s+/g,' ').trim(); }
function sentenceWithHope(text){
  const parts = clean(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return parts.map(clean).find(s => /\bhope\b/i.test(s) && s.split(/\s+/).length > 3) || '';
}

async function searchDuckDuckGo(page){
  const url = 'https://duckduckgo.com/?q=hope&iar=news&ia=news';
  await page.goto(url, { waitUntil:'domcontentloaded', timeout:45000 });
  await page.waitForTimeout(2500);

  // DuckDuckGo changes markup periodically, so use several selectors.
  const selectors = [
    'a[data-testid="result-title-a"]',
    'article a[href]',
    'a.result__a',
    '[data-testid="result"] a[href]'
  ];
  let results = [];
  for(const sel of selectors){
    results = await page.$$eval(sel, links => links.map(a => ({
      title:(a.innerText || a.textContent || '').trim(),
      url:a.href
    })).filter(x => x.title && /^https?:\/\//.test(x.url)));
    if(results.length) break;
  }

  const seen = new Set();
  return results.filter(r => {
    try{
      const u = new URL(r.url);
      if(/duckduckgo\.com$/i.test(u.hostname)) return false;
      const key = r.url.split('#')[0];
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    }catch(e){ return false; }
  });
}

async function processArticle(browser, result){
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
  });
  const page = await context.newPage();
  try{
    await page.goto(result.url, { waitUntil:'domcontentloaded', timeout:45000 });
    await page.waitForTimeout(1800);

    // Prefer paragraph-like content, then fall back to any visible text element.
    const candidate = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('p, article p, main p, li, blockquote, h1, h2, h3, div'));
      const visible = el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 20 && r.height > 10 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const good = els.filter(el => {
        const t = (el.innerText || '').replace(/\s+/g,' ').trim();
        return visible(el) && /\bhope\b/i.test(t) && t.split(/\s+/).length > 3 && t.length < 1800;
      });
      if(!good.length) return null;
      // Prefer the smallest meaningful container, close to the original Selenium behavior.
      good.sort((a,b) => (a.innerText || '').length - (b.innerText || '').length);
      const el = good[0];
      el.dataset.hopeTarget = '1';
      return { text:(el.innerText || '').replace(/\s+/g,' ').trim() };
    });
    if(!candidate) return null;

    const sentence = sentenceWithHope(candidate.text);
    if(!sentence) return null;

    const locator = page.locator('[data-hope-target="1"]');
    await locator.scrollIntoViewIfNeeded();
    await locator.evaluate(el => {
      el.dataset.hopeOldStyle = el.getAttribute('style') || '';
      el.style.setProperty('background', 'yellow', 'important');
      el.style.setProperty('border', '2px solid red', 'important');
    });
    await page.waitForTimeout(500);

    const screenshot = await page.screenshot({ type:'jpeg', quality:78, fullPage:false });
    let source = '';
    try { source = new URL(page.url()).hostname.replace(/^www\./,''); } catch(e){}

    return {
      status:'ok',
      title: clean(await page.title()) || result.title,
      url: page.url(),
      source,
      sentence,
      passage: candidate.text,
      screenshot: screenshot.toString('base64')
    };
  } catch(e){
    return null;
  } finally {
    await context.close();
  }
}

app.get('/health', (req,res) => res.json({ok:true, work:'HOPE', keyword:'hope'}));

app.get('/api/next', async (req,res) => {
  const session = String(req.query.session || 'default').slice(0,120);
  const st = stateFor(session);
  let browser;
  try{
    browser = await chromium.launch({ headless:true, args:['--no-sandbox'] });
    const searchContext = await browser.newContext({ viewport:{width:1440,height:900} });
    const searchPage = await searchContext.newPage();

    if(st.results.length === 0 || st.cursor >= st.results.length){
      st.results = await searchDuckDuckGo(searchPage);
      st.cursor = 0;
      st.lastSearch = Date.now();
    }
    await searchContext.close();

    while(st.cursor < st.results.length){
      const result = st.results[st.cursor++];
      if(st.visited.has(result.url)) continue;
      st.visited.add(result.url);
      const item = await processArticle(browser, result);
      if(item) return res.json(item);
    }

    // Refresh the live search rather than declaring an end state.
    st.results = [];
    st.cursor = 0;
    return res.json({status:'searching'});
  }catch(e){
    console.error(e);
    res.status(500).json({error:'HOPE engine failed', detail:String(e.message || e)});
  }finally{
    if(browser) await browser.close();
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`HOPE engine listening on ${PORT}`));
