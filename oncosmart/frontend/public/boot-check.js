/*
 * Start-up safety net (no application logic). If the app bundle cannot start — unsupported
 * browser, a script that failed to download, or an error while rendering — show a readable
 * message instead of a blank page. Written in ES5 so it runs even where the bundle cannot.
 */
(function () {
  var root = document.getElementById('root');
  if (!root) return;
  var ui = 'font-family:system-ui,sans-serif;';

  function appRendered() {
    // The app replaces the static placeholder on its first render
    return root.childElementCount > 0 && !root.querySelector('[data-boot]');
  }

  var shownLevel = 0;
  function show(level, title, lines) {
    if (level <= shownLevel || appRendered()) return;
    shownLevel = level;
    var box = document.createElement('div');
    box.setAttribute('data-boot', 'message');
    box.setAttribute('style', ui + 'max-width:34rem;margin:3rem auto;padding:1.25rem;border:1px solid #fca5a5;border-radius:.75rem;background:#fff;color:#0f172a;');
    var h = document.createElement('h1');
    h.setAttribute('style', 'font-size:1.1rem;font-weight:600;margin:0 0 .75rem;');
    h.textContent = title;
    box.appendChild(h);
    for (var i = 0; i < lines.length; i++) {
      var p = document.createElement('p');
      p.setAttribute('dir', 'auto');
      p.setAttribute('style', 'margin:.4rem 0;font-size:.9rem;word-break:break-word;');
      p.textContent = lines[i];
      box.appendChild(p);
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('style', 'margin-top:.75rem;padding:.5rem 1rem;border-radius:.5rem;border:1px solid #cbd5e1;background:#f8fafc;');
    btn.textContent = 'Reload · إعادة التحميل';
    btn.addEventListener('click', function () { location.reload(); });
    box.appendChild(btn);
    root.innerHTML = '';
    root.appendChild(box);
  }

  function fail(detail) {
    // Let the app finish its render first; only report when the page would otherwise stay blank
    setTimeout(function () {
      show(2, 'OncoSmart could not start in this browser', [
        'تعذّر تشغيل OncoSmart في هذا المتصفح.',
        'Details: ' + detail,
        'Browser: ' + navigator.userAgent,
      ]);
    }, 100);
  }

  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && t !== window && t.tagName) fail('could not load ' + (t.src || t.href || t.tagName));
    else fail((e && e.message) || 'script error');
  }, true);

  setTimeout(function () {
    show(1, 'OncoSmart is still loading…', [
      'If this message does not change, reload the page.',
      'إذا لم تتغير هذه الرسالة، أعد تحميل الصفحة.',
      'Browser: ' + navigator.userAgent,
    ]);
  }, 20000);

  // Inside an editor preview frame (Codespaces "Preview in Editor"), browsers may block sign-in cookies
  var framed;
  try { framed = window.self !== window.top; } catch (err) { framed = true; }
  if (framed) {
    var bar = document.createElement('a');
    bar.href = location.href;
    bar.target = '_blank';
    bar.rel = 'noopener';
    bar.setAttribute('style', ui + 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:.6rem 1rem;background:#1e3a8a;color:#fff;font-size:.85rem;text-align:center;text-decoration:none;');
    bar.textContent = 'Shown inside a preview panel — if sign-in does not work here, tap to open OncoSmart in its own browser tab ↗';
    document.body.appendChild(bar);
  }
})();
