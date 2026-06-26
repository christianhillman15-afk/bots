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
