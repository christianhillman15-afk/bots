/* =========================================================
   SURGE — interactions
   ========================================================= */
(function () {
  'use strict';

  /* ---- Footer year ---- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---- Sticky nav background on scroll ---- */
  var nav = document.getElementById('nav');
  var onScroll = function () {
    if (window.scrollY > 24) nav.classList.add('is-scrolled');
    else nav.classList.remove('is-scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---- Mobile menu toggle ---- */
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('is-open');
      toggle.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Close menu when a link is tapped
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        links.classList.remove('is-open');
        toggle.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---- Scroll reveal ---- */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---- Animated stat counters ---- */
  var stats = document.querySelectorAll('.stat__num');
  var animateStat = function (el) {
    var target = parseFloat(el.getAttribute('data-target')) || 0;
    var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    var duration = 1600;
    var start = null;
    var step = function (ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      var val = target * eased;
      el.textContent = prefix + val.toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = prefix + target.toFixed(decimals) + suffix;
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window && stats.length) {
    var statIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateStat(entry.target);
          statIO.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    stats.forEach(function (s) { statIO.observe(s); });
  }

  /* ---- FAQ: single-open accordion ---- */
  var faqItems = document.querySelectorAll('.faq__item');
  faqItems.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (item.open) {
        faqItems.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      }
    });
  });

  /* ---- Lead form (demo handler) ---- */
  var form = document.getElementById('leadForm');
  var note = document.getElementById('formNote');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.elements['name'].value.trim();
      var phone = form.elements['phone'].value.trim();
      var trade = form.elements['trade'].value;
      if (!name || !phone || !trade) {
        if (note) {
          note.hidden = false;
          note.style.color = '#ff5d76';
          note.style.background = 'rgba(255,45,77,0.1)';
          note.style.borderColor = 'rgba(255,45,77,0.3)';
          note.textContent = 'Please add your name, phone, and trade so we can reach you.';
        }
        return;
      }
      if (note) {
        note.hidden = false;
        note.style.color = '#7CFFB2';
        note.style.background = 'rgba(40,200,120,0.1)';
        note.style.borderColor = 'rgba(40,200,120,0.3)';
        note.textContent = 'Got it, ' + name + '! Your free audit request is in — we\'ll reach out within 1 business day.';
      }
      form.reset();
      // TODO: wire this up to your CRM / GoHighLevel / email service or a form endpoint.
    });
  }
})();

/* =========================================================
   FUTURISTIC FX
   ========================================================= */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---- Neon scroll-progress bar ---- */
  var bar = document.getElementById('scrollProgress');
  if (bar) {
    var updBar = function () {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', updBar, { passive: true });
    window.addEventListener('resize', updBar);
    updBar();
  }

  /* ---- Mouse-follow spotlight ---- */
  var glow = document.getElementById('cursorGlow');
  if (glow && fine && !reduce) {
    var gx = innerWidth / 2, gy = innerHeight / 2, cx = gx, cy = gy, shown = false;
    document.addEventListener('mousemove', function (e) {
      gx = e.clientX; gy = e.clientY;
      if (!shown) { glow.style.opacity = '1'; shown = true; }
    });
    document.addEventListener('mouseleave', function () { glow.style.opacity = '0'; shown = false; });
    (function loop() {
      cx += (gx - cx) * 0.15; cy += (gy - cy) * 0.15;
      glow.style.transform = 'translate(' + cx + 'px,' + cy + 'px) translate(-50%,-50%)';
      requestAnimationFrame(loop);
    })();
  } else if (glow) { glow.remove(); }

  /* ---- Hero particle constellation ---- */
  var canvas = document.getElementById('fxCanvas');
  var hero = document.getElementById('top');
  if (canvas && hero && !reduce) {
    var ctx = canvas.getContext('2d');
    var pts = [], W = 0, H = 0, raf = null;
    var colors = ['rgba(91,140,255,', 'rgba(176,114,255,', 'rgba(255,93,118,'];
    var LINK = 15000;
    function init() {
      var n = Math.min(80, Math.floor((W * H) / 15000));
      pts = [];
      for (var i = 0; i < n; i++) {
        pts.push({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.45, vy: (Math.random() - 0.5) * 0.45,
          c: colors[i % colors.length]
        });
      }
    }
    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = hero.offsetWidth; H = hero.offsetHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      init();
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
        ctx.fillStyle = p.c + '0.9)'; ctx.fill();
        for (var j = i + 1; j < pts.length; j++) {
          var q = pts[j], dx = p.x - q.x, dy = p.y - q.y, d = dx * dx + dy * dy;
          if (d < LINK) {
            ctx.strokeStyle = p.c + (0.5 * (1 - d / LINK)).toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }
    size();
    draw();
    window.addEventListener('resize', size);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { if (!raf) draw(); }
          else if (raf) { cancelAnimationFrame(raf); raf = null; }
        });
      }, { threshold: 0 }).observe(hero);
    }
  } else if (canvas) { canvas.remove(); }
})();
