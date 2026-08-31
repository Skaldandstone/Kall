"""Build isolated round-two studies from the retained round-one prototype."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
source = (ROOT.parent / "mockup.js").read_text(encoding="utf-8")
source = source.replace("'edition'", "'inscription'").replace("'vector'", "'stave'").replace("'horizon'", "'fjord'")
start = source.index("const mark =")
end = source.index("\nconst nav =", start)
source = source[:start] + '''const mark = `<svg class="rune" aria-hidden="true" viewBox="0 0 32 32"><rect x="9.2" y="1.6" width="3.6" height="28.8" fill="var(--accent)"/><path d="M26.2 4.6 L6.8 16 L26.2 27.4" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="butt" stroke-linejoin="miter"/></svg>`;''' + source[end:]
source = source.replace("${theme==='stave'?'Kall':'kall'}", "Kall")
source = source.replace("UNAPPROVED CONCEPT /", "ROUND 02 / UNAPPROVED /")
source = source.replace("Your next move, with intention.", "Find your calling.")
source = source.replace("Design study · Not a live application", "Career-first study · Fictional data")
start = source.index("function brief()")
end = source.index("function opportunities()", start)
source = source[:start] + '''function brief(){return heading('YOUR CAREER / MONDAY, 31 AUGUST','Your career, in view.','A clear direction, a record you own, and time to consider what comes next.')+`
  <section class="hero-grid"><article class="focus-card"><div class="focus-top"><p class="eyebrow">YOUR CURRENT DIRECTION</p><span class="quiet-label">Career strategy</span></div><h2>Quality Engineering<br class="desktop-only"> leadership</h2><p class="focus-description">Lead thoughtful teams. Build confidence into complex products. Keep the work you want connected to the experience you already have.</p><div class="direction-facts"><p><span>Target roles</span>Director of Quality Engineering · Head of Quality</p><p><span>Work that matters to you</span>Quality Engineering · Engineering Leadership</p><p><span>Working preferences</span>Remote · United States</p></div>${link('Review your career strategy '+icon('arrow'),'career','button')}<p class="fineprint">From your saved strategy. You can change this direction at any time.</p></article>
  <aside class="panel record-summary"><p class="eyebrow">YOUR PROFESSIONAL RECORD</p><h2>The work behind<br>the next chapter.</h2><div class="record-entry"><span>2021–2026</span><h3>Quality Engineering Manager</h3><p>Example Company</p><p>Led a 12-person quality team across three product groups.</p></div><p class="record-caption">Your recorded experience, kept in your control.</p>${link('Open your career record '+icon('arrow'),'career','text-link')}</aside></section>
  <div class="lower-grid"><section class="panel"><div class="section-title"><h2>Opportunities in context</h2>${link('Explore','opportunities')}</div><p class="section-intro">Three roles connect with your current strategy. Review the evidence when you are ready.</p>${jobRow('Director, Quality Engineering','Northstar Labs',92,'N')}${jobRow('Head of Quality','Signal Works',87,'S',true)}</section><aside class="panel next-step"><p class="eyebrow">PREPARED FOR YOUR REVIEW</p><h2>Your application,<br>your decision.</h2><p>The Northstar Labs draft is ready to review. Confirm the facts and sensitive fields before approving preparation.</p>${link('Open application review '+icon('arrow'),'review','text-link')}<div class="quiet-status">Nothing submitted · Your approval is required</div></aside></div>`;}
''' + source[end:]
source = source.replace("'Find work that fits.'", "'Opportunities, in context.'").replace("'Your strategy, translated into possibilities.'", "'Explore roles against your direction. Understand the evidence before deciding.'")
source = source.replace("'Make it yours before it goes.'", "'Review what represents you.'")
source = source.replace("'A direction that is yours.'", "'Your career, over time.'")
source = source.replace("'Define the work you want. Keep the full story behind it.'", "'Your strategy and professional record, with room to develop.'")
source = source.replace("<span>Work history</span>","<span>Work history</span>")
source = source.replace("<span>Growth</span><span>References</span>","<span>Growth</span><span>Achievements</span><span>References</span>")
source = source.replace("<h2>Build toward <br>what comes next.</h2>","<h2>Development,<br> at your pace.</h2>")
source = source.replace("<a class=\"text-link\" href=\"${preview('career')}\">Explore growth", "<a class=\"text-link\" href=\"#\" data-demo>Explore growth")
source = source.replace("Evidence-based fit", "Heuristic fit")
source = source.replace("<small>Quality Engineering aligns with your strategy. One bonus, capped at 10 points.</small>", "<small>Deterministic heuristic: Quality Engineering matches your strategy. One bonus, capped at 10 points. Missing evidence adds no penalty.</small>")
(ROOT / "mockup.js").write_text(source, encoding="utf-8")
css = (ROOT.parent / "mockup.css").read_text(encoding="utf-8")
css = css.replace("data-theme=vector", "data-theme=stave").replace("data-theme=horizon", "data-theme=fjord")
css += '''
/* Round two follows the KHIG foundation; the existing rune geometry is invariant. */
body{--bg:#1b1c1d;--panel:#232526;--ink:#e8e6df;--muted:#b4b7b8;--line:#42494c;--accent:#a2bbc6;--accent-ink:#142026;--soft:#2b3438;--radius:2px}
body[data-theme=stave]{--bg:#151a1d;--panel:#20282d;--ink:#e8e6df;--muted:#b0bdc3;--line:#3a474e;--accent:#9bbac8;--accent-ink:#132027;--soft:#28353c;--radius:2px}
body[data-theme=fjord]{--bg:#172126;--panel:#23323a;--ink:#e9e7df;--muted:#b8c7cd;--line:#40525b;--accent:#a1c2cf;--accent-ink:#13242b;--soft:#293e48;--radius:7px}
body[data-theme=current]{--bg:#0c1420;--panel:#131d2c;--ink:#e8ecf2;--muted:#94a5bc;--line:#2b3d55;--accent:#c9a86a;--accent-ink:#0c1420;--soft:#1c2839;--radius:8px}
.wordmark .rune{width:35px;height:35px;display:block;flex-shrink:0}.wordmark{gap:13px;letter-spacing:-1.5px;font-size:35px}.study-band{background:var(--panel);color:var(--muted);border-bottom:1px solid var(--line)}
.direction-facts{margin:24px 0;border-top:1px solid var(--line)}.direction-facts p{font-size:13px;margin:0;padding:12px 0;border-bottom:1px solid var(--line)}.direction-facts span{display:block;color:var(--muted);font-size:10px;margin-bottom:4px}.record-summary{background:transparent;padding:32px}.record-summary h2{font-size:30px;margin:22px 0}.record-entry{border-left:2px solid var(--accent);padding:0 0 0 19px;margin:30px 0}.record-entry>span{font:10px var(--mono);color:var(--muted)}.record-entry h3{font-size:15px;margin:14px 0 7px}.record-entry p{font-size:12px;color:var(--muted);line-height:1.8}.record-caption{color:var(--muted);font-size:11px}.section-intro{color:var(--muted);font-size:11px}.focus-card h2{font-size:36px}.focus-description{font-size:13px;max-width:550px}.focus-card>.button{margin-top:4px}.job-row .match-small{color:var(--muted)}.job-detail .intelligence-title{align-items:center}.career-tabs{gap:22px}.screen-footer{font-size:9px}.job-card.selected{box-shadow:none}.button{min-height:44px}.fineprint{font-size:10px}.button.secondary{min-height:44px}
@media(max-width:760px){.study-band{font-size:7px}.wordmark .rune{width:29px;height:29px}.record-summary{padding:23px}.record-summary h2{font-size:25px;margin:10px 0}.record-entry{margin:20px 0}.direction-facts{margin:18px 0}.direction-facts p{font-size:11px;padding:10px 0}.direction-facts span{font-size:9px}.focus-description{font-size:11px}.record-entry h3{font-size:13px}.record-entry p{font-size:11px}.section-intro{font-size:10px}.hero-grid{gap:0}.record-caption{font-size:10px}.record-summary .text-link{font-size:10px}.career-tabs{gap:19px}.fineprint{font-size:8px}}
@media(max-width:760px){body[data-screen=brief] .page-heading{margin-bottom:22px}body[data-screen=brief] .focus-top{margin-bottom:18px}body[data-screen=brief] .focus-description{margin:14px 0}body[data-screen=brief] .direction-facts{margin:12px 0}body[data-screen=brief] .direction-facts p{padding:8px 0}body[data-screen=brief] .fineprint{margin-top:14px}body[data-screen=brief] .record-summary{padding:18px}body[data-screen=brief] .record-entry{margin:14px 0}body[data-screen=brief] .record-entry p{line-height:1.6}body[data-screen=brief] .lower-grid .panel{padding:18px}body[data-screen=brief] .quiet-status{margin-top:18px;padding-top:12px}}
'''
css += '''
@media(max-width:760px){body[data-screen=brief] .focus-card h2{font-size:30px}body[data-screen=brief] .hero-grid{gap:16px}}
'''
(ROOT / "mockup.css").write_text(css, encoding="utf-8")
