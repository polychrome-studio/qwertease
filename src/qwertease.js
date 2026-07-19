/*!
 * QWERTease — QWERTY-aware, easing-based typing timing.
 * MIT License. https://github.com/polychrome-studio/qwertease
 *
 * Types like a person, not a metronome: keystroke delay is derived from real
 * QWERTY key geometry — which hand a key is on, how far it is from the
 * previous key, and whether it's a key your fingers rest on (home row) or
 * have to reach for. Optional mistake simulation reuses that same geometry
 * to pick a plausible wrong key, rather than a separate lookup table.
 */
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? (module.exports = factory())
    : typeof define === 'function' && define.amd
    ? define(factory)
    : (global.QWERTease = factory());
})(this, function () {
  'use strict';

  // Approximate physical position of each key on a standard QWERTY layout,
  // [row, column] — column includes the real stagger offset between rows,
  // so distance between two keys reflects actual finger travel, not just
  // "how many keys apart" in a flat grid.
  var KEY_POS = {
    q: [0, 0], w: [0, 1], e: [0, 2], r: [0, 3], t: [0, 4],
    y: [0, 5], u: [0, 6], i: [0, 7], o: [0, 8], p: [0, 9],
    a: [1, 0.25], s: [1, 1.25], d: [1, 2.25], f: [1, 3.25], g: [1, 4.25],
    h: [1, 5.25], j: [1, 6.25], k: [1, 7.25], l: [1, 8.25],
    z: [2, 0.75], x: [2, 1.75], c: [2, 2.75], v: [2, 3.75], b: [2, 4.75],
    n: [2, 5.75], m: [2, 6.75]
  };

  var LEFT_HAND = 'qwertasdfgzxcvb';
  var RIGHT_HAND = 'yuiophjklnm';
  // Home row lands fastest — that's where a touch-typist's fingers actually
  // rest. Top row is the next-fastest reach. Everything else (bottom row,
  // punctuation) is slowest. This groups y/p with the slow tier rather than
  // strict row geometry — in practice those two feel like more of a stretch
  // than the rest of the top row.
  var FAST_TIER = 'asdfghjkl';
  var MED_TIER = 'qwertuio';

  function dist(a, b) {
    var dx = KEY_POS[a][1] - KEY_POS[b][1];
    var dy = KEY_POS[a][0] - KEY_POS[b][0];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handOf(ch) {
    if (LEFT_HAND.indexOf(ch) !== -1) return 'L';
    if (RIGHT_HAND.indexOf(ch) !== -1) return 'R';
    return null;
  }

  // The core timing model. Given the previous character typed and the one
  // about to be typed, return a delay in ms — the same function powers both
  // normal typing and the correction phase of a simulated mistake.
  function keyDelay(prevChar, ch, base) {
    var c = ch.toLowerCase();
    var p = prevChar ? prevChar.toLowerCase() : null;
    var jitter = 0.85 + Math.random() * 0.3;

    if (c === ' ') return Math.round(base * 0.8 * jitter);

    var tier = FAST_TIER.indexOf(c) !== -1 ? 1 : MED_TIER.indexOf(c) !== -1 ? 1.18 : 1.4;
    var mult = 1;

    if (p && KEY_POS[p] && KEY_POS[c]) {
      if (p === c) {
        mult = 0.55; // repeated key — minimal travel
      } else {
        var handP = handOf(p);
        var handC = handOf(c);
        if (handP && handC && handP !== handC) {
          mult = 0.72; // alternating hands — the other hand can prep in parallel
        } else {
          mult = 0.95 + Math.min(dist(p, c) * 0.13, 0.55); // same hand — scaled by reach
        }
      }
    } else if (!KEY_POS[c]) {
      mult = 1.15; // punctuation and anything off the letter grid
    }

    return Math.round(base * tier * mult * jitter);
  }

  // Nearest physical keys to `ch`, closest first — the same geometry that
  // drives timing also drives which key a plausible mistake would hit.
  function nearestKeys(ch, n) {
    var c = ch.toLowerCase();
    if (!KEY_POS[c]) return [];
    var out = [];
    for (var k in KEY_POS) {
      if (k === c) continue;
      out.push([k, dist(c, k)]);
    }
    out.sort(function (a, b) { return a[1] - b[1]; });
    return out.slice(0, n || 3).map(function (d) { return d[0]; });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * @param {HTMLElement} el — receives the typed text as child text nodes.
   * @param {Object} [options]
   * @param {number} [options.speed=80] — base ms/keystroke (home-row baseline;
   *   actual per-character delay varies from there).
   * @param {boolean} [options.mistakes=false] — occasionally mistype an
   *   adjacent key, pause, backspace, and retype the correct one.
   * @param {number} [options.mistakeRate=0.035] — chance per eligible
   *   character (0–1).
   * @param {boolean} [options.cursor=true] — append a blinking cursor span.
   * @param {string} [options.cursorClass='qwertease-cursor']
   */
  function QWERTease(el, options) {
    this.el = el;
    this.options = Object.assign({
      speed: 80,
      mistakes: false,
      mistakeRate: 0.035,
      cursor: true,
      cursorClass: 'qwertease-cursor'
    }, options || {});
    this.cursorEl = null;
    if (this.options.cursor) {
      this.cursorEl = document.createElement('span');
      this.cursorEl.className = this.options.cursorClass;
      this.el.appendChild(this.cursorEl);
    }
  }

  QWERTease.prototype._insert = function (ch) {
    var node = document.createTextNode(ch);
    if (this.cursorEl) this.el.insertBefore(node, this.cursorEl);
    else this.el.appendChild(node);
  };

  QWERTease.prototype._removeLast = function () {
    var nodes = this.el.childNodes;
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].nodeType === 3 && nodes[i].textContent.length) {
        nodes[i].textContent = nodes[i].textContent.slice(0, -1);
        return;
      }
    }
  };

  /**
   * Type `text` into the element, character by character, with human-like
   * pacing. Resolves once the text is fully typed (mistakes and all).
   */
  QWERTease.prototype.type = async function (text) {
    var base = this.options.speed;
    var prev = null;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var canSlip = this.options.mistakes && KEY_POS[ch.toLowerCase()] && Math.random() < this.options.mistakeRate;

      if (canSlip) {
        var wrong = nearestKeys(ch, 3);
        var wrongCh = wrong[Math.floor(Math.random() * wrong.length)];
        if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) wrongCh = wrongCh.toUpperCase();

        this._insert(wrongCh);
        await sleep(keyDelay(prev, wrongCh, base));
        prev = wrongCh;

        await sleep(base * (2.4 + Math.random() * 1.6)); // the beat before noticing

        this._removeLast();
        await sleep(keyDelay(prev, ch, base) * 0.8); // backspace is quicker than typing
      }

      this._insert(ch);
      await sleep(keyDelay(prev, ch, base));
      prev = ch;
    }
  };

  QWERTease.keyDelay = keyDelay;
  QWERTease.nearestKeys = nearestKeys;

  return QWERTease;
});
