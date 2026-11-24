/* PaperShelf – pasting formatted text (Word, web pages, Excel) into a document as Markdown, and small table helpers.
   Everything happens in the browser, on this computer. */
'use strict';

const Clip = (() => {
  const BUL = /^[\s\u00a0]*[\u00b7\u2022\u25aa\u25cf\u25e6\u25cb\u25a0\u25a1\u2013\u2014\u2219\uf0b7\uf0a7\uf0d8\-*o§][\s\u00a0]+/;
  const clean = s => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  const esc = s => s.replace(/\|/g, '\\|');

  /* ---------- HTML -> Markdown ---------- */
  function inline(node, st = {}) {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += clean(n.nodeValue).replace(/\n+/g, ' '); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName.toLowerCase();
      if (['style', 'script', 'head', 'img', 'svg', 'o:p', 'xml'].includes(t) || /^o:|^v:|^w:/.test(t)) continue;
      if (n.style && /mso-list:\s*Ignore/i.test(n.getAttribute('style') || '')) continue;           // the bullet/number Word draws itself
      const inner = inline(n, st);
      if (t === 'br') out += ' ';
      else if (t === 'b' || t === 'strong' || /font-weight:\s*(bold|[6-9]00)/i.test(n.getAttribute('style') || '')) out += wrapMd(inner, '**');
      else if (t === 'i' || t === 'em' || /font-style:\s*italic/i.test(n.getAttribute('style') || '')) out += wrapMd(inner, '*');
      else if (t === 's' || t === 'strike' || t === 'del') out += wrapMd(inner, '~~');
      else if (t === 'code' || t === 'kbd' || t === 'tt') out += inner.trim() ? '`' + inner.trim() + '`' : '';
      else if (t === 'a' && /^https?:/i.test(n.getAttribute('href') || '') && inner.trim()) out += `[${inner.trim()}](${n.getAttribute('href')})`;
      else out += inner;
    }
    return out;
  }
  function wrapMd(s, m) { const t = s.trim(); if (!t) return s; const l = s.match(/^\s*/)[0], r = s.match(/\s*$/)[0]; return l + m + t + m + r; }

  function table(el) {
    const rows = [...el.querySelectorAll('tr')].filter(tr => tr.closest('table') === el).map(tr => [...tr.children].filter(c => /^t[dh]$/i.test(c.tagName)).flatMap(c => {
      const txt = esc(inline(c).replace(/\s+/g, ' ').trim()), span = Math.min(+c.getAttribute('colspan') || 1, 20); return [txt, ...Array(span - 1).fill('')]; }));
    if (!rows.length) return '';
    const n = Math.max(...rows.map(r => r.length)); rows.forEach(r => { while (r.length < n) r.push(''); });
    return render(rows);
  }
  function render(rows) {
    const n = Math.max(...rows.map(r => r.length)); rows = rows.map(r => { r = r.slice(); while (r.length < n) r.push(''); return r; });
    const isDash = r => r.some(c => c !== MERGE) && r.every(c => c === MERGE || c === '' || /^:?-{3,}:?$/.test(c)) && r.some(c => /-/.test(c));
    const w = Array.from({length: n}, (_, i) => Math.max(3, ...rows.filter(r => !isDash(r)).map(r => r[i] === MERGE ? 0 : r[i].length)));
    const dash = '|' + w.map(x => '-'.repeat(x + 2)).join('|') + '|';
    const line = r => isDash(r) ? dash : '|' + r.map((c, i) => c === MERGE ? '' : ' ' + c.padEnd(w[i]) + ' ').join('|') + '|';
    return [line(rows[0]), dash, ...rows.slice(1).map(line)].join('\n');
  }

  function blocks(root) {
    const out = [];
    const listLevel = (el) => { const m = /level(\d+)/i.exec(el.getAttribute('style') || ''); return m ? Math.max(0, +m[1] - 1) : 0; };
    const walk = (node, depth = 0, ordered = null, counter = {n: 0}) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { const t = clean(n.nodeValue).trim(); if (t) out.push(t); continue; }
        if (n.nodeType !== 1) continue;
        const t = n.tagName.toLowerCase(), cls = n.getAttribute('class') || '', sty = n.getAttribute('style') || '';
        if (['style', 'script', 'head', 'img', 'svg', 'xml', 'meta', 'link', 'title'].includes(t) || /^o:|^v:|^w:/.test(t)) continue;
        if (/^h[1-6]$/.test(t)) { const x = inline(n).trim(); if (x) out.push('#'.repeat(+t[1]) + ' ' + x); }
        else if (t === 'table') { const x = table(n); if (x) out.push(x); }
        else if (t === 'ul' || t === 'ol') { const c = {n: 0}; const before = out.length; walk(n, depth + 1, t === 'ol', c); glue(out, before); }
        else if (t === 'li') {
          const sub = [...n.children].filter(c => /^(ul|ol)$/i.test(c.tagName)); const clone = n.cloneNode(true); clone.querySelectorAll('ul,ol').forEach(x => x.remove());
          const x = inline(clone).trim(); const ind = '  '.repeat(Math.max(0, depth - 1));
          out.push(ind + (ordered ? `${++counter.n}. ` : '- ') + x); const before = out.length; sub.forEach(s => walk({childNodes: [s]}, depth, null, {n: 0})); glue(out, before - 1, true);
        }
        else if (t === 'p' || t === 'div' || t === 'section' || t === 'article' || t === 'blockquote' || t === 'pre' || t === 'center') {
          if (/MsoList/i.test(cls) || /mso-list:\s*l\d/i.test(sty)) {                // a Word list item (a plain paragraph with a hand-drawn bullet)
            let x = inline(n).trim(); const num = /^(\d+|[a-z]|[ivx]+)[.)]\s+/i.exec(x); const bullet = !num && BUL.test(x);
            x = x.replace(num ? /^(\d+|[a-z]|[ivx]+)[.)]\s+/i : BUL, ''); const ind = '  '.repeat(listLevel(n)); out.push(ind + (num ? `${/^\d+$/.test(num[1]) ? num[1] : '1'}. ` : '- ') + x.trim()); void bullet;
          } else if (n.querySelector('table,ul,ol,h1,h2,h3,h4,h5,h6,p,div')) walk(n, depth, ordered, counter);
          else { let x = inline(n).trim(); if (x) { if (t === 'blockquote') x = '> ' + x; if (t === 'pre') x = '`' + x + '`'; out.push(x.replace(BUL, m => m.trim() ? '- ' : m)); } }
        }
        else { const x = inline({childNodes: [n]}).trim(); if (x) out.push(x); }
      }
    };
    walk(root);
    // consecutive list lines stay together, everything else is separated by a blank line
    let md = '', prev = '';
    for (const b of out) { const isList = /^\s*(- |\d+\. )/.test(b); md += (md ? (isList && /^\s*(- |\d+\. )/.test(prev) ? '\n' : '\n\n') : '') + b; prev = b; }
    return md.trim();
  }
  function glue() { /* list lines are joined by the loop above; kept for readability */ }

  function htmlToMd(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style,script').forEach(x => x.remove());
    const frag = doc.body.querySelector('[id^="docs-internal-guid"]') ? doc.body : doc.body;
    return blocks(frag);
  }

  /* ---------- plain text (Excel, bullets drawn by hand) ---------- */
  function plainToMd(text) {
    let t = String(text || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    const lines = t.split('\n'), non = lines.filter(l => l.trim());
    if (non.length >= 2 && non.every(l => l.includes('\t'))) {                                // spreadsheet cells -> table
      const rows = non.map(l => l.split('\t').map(c => esc(c.trim()))); return render(rows);
    }
    return lines.map(l => /^\s*[\u00b7\u2022\u25aa\u25cf\uf0b7\uf0a7]\s*/.test(l) ? l.replace(/^\s*[\u00b7\u2022\u25aa\u25cf\uf0b7\uf0a7]\s*/, '- ') : l).join('\n');
  }

  /* what is on the clipboard: formatted text wins over the picture Word and others add next to it */
  function fromClipboard(dt) {
    const html = dt.getData('text/html') || '', plain = dt.getData('text/plain') || '';
    const hasText = !!(plain.trim() || html.replace(/<[^>]*>/g, '').trim());
    const file = [...(dt.files || [])].find(f => f.type.startsWith('image/'));
    if (!hasText) return {image: file || null, md: ''};
    let md = '';
    if (html && /<(table|ul|ol|li|h[1-6]|b|strong|i|em|a|p)\b/i.test(html)) { try { md = htmlToMd(html); } catch (e) { md = ''; } }
    if (!md.trim()) md = plainToMd(plain);
    return {image: null, md: md.replace(/\n{3,}/g, '\n\n')};
  }

  /* ---------- tables in the Markdown source ---------- */
  const MERGE = '\u0001';   // a cell written as '||' (no space between the bars) is merged into the one before it
  const isRow = l => /^\s*\|.*\|\s*$/.test(l);
  const isSep = l => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes('-');
  const cells = l => { const s = l.trim().replace(/^\|/, '').replace(/\|$/, ''); const out = []; let cur = ''; for (let i = 0; i < s.length; i++) { if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; } else if (s[i] === '|') { out.push(cur === '' && out.length ? MERGE : cur.trim()); cur = ''; } else cur += s[i]; } out.push(cur === '' && out.length ? MERGE : cur.trim()); return out; };
  /* the table around position `pos` of `text`, or null */
  function tableAt(text, pos) {
    const starts = []; let o = 0; const lines = text.split('\n'); lines.forEach(l => { starts.push(o); o += l.length + 1; });
    let li = starts.findIndex((s, i) => pos >= s && pos <= s + lines[i].length); if (li < 0 || !isRow(lines[li])) return null;
    let a = li, b = li; while (a > 0 && isRow(lines[a - 1])) a--; while (b < lines.length - 1 && isRow(lines[b + 1])) b++;
    if (b - a < 1 || !isSep(lines[a + 1])) return null;
    const rows = []; for (let i = a; i <= b; i++) if (i !== a + 1) rows.push(cells(lines[i]));
    const col = Math.max(0, (text.slice(starts[li], pos).match(/(?<!\\)\|/g) || []).length - 1);
    return {a, b, row: li <= a ? 0 : li - a - 1, col, rows, start: starts[a], end: starts[b] + lines[b].length};
  }
  function edit(text, pos, op) {
    const T = tableAt(text, pos); if (!T) return null;
    let {rows, row, col} = T; const n = Math.max(...rows.map(r => r.length)); rows = rows.map(r => { r = r.slice(); while (r.length < n) r.push(''); return r; });
    col = Math.min(col, n - 1);
    if (op === 'addrow') rows.splice(row + 1, 0, Array(n).fill(''));
    else if (op === 'addcol') rows.forEach(r => r.splice(col + 1, 0, ''));
    else if (op === 'delrow') { if (rows.length <= 2) return {error: 'A table needs a header row and at least one more row.'}; if (row === 0) return {error: 'The first row is the header; it cannot be deleted.'}; rows.splice(row, 1); }
    else if (op === 'delcol') { if (n <= 1) return {error: 'A table needs at least one column.'}; rows.forEach(r => r.splice(col, 1)); }
    else if (op !== 'fmt') return null;
    const md = render(rows); return {text: text.slice(0, T.start) + md + text.slice(T.end), caret: T.start + md.split('\n')[0].indexOf('|') + 2};
  }

  return {fromClipboard, htmlToMd, plainToMd, tableAt, edit};
})();
