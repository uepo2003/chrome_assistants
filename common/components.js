/* Quickstart Copilot — shared component helpers (vanilla JS, no build).
 *
 * Loaded BEFORE per-surface scripts in popup/sidepanel/options HTML. Plain
 * script — no module syntax. Idempotent: re-loading is a no-op.
 *
 * Exposes globalThis.__QC_UI__ with:
 *   modal: { open(el), close(el), toggle(el, open?), bind(el, opts?) }
 *   pill:  { setState(el, state) }
 *
 * Modal contract:
 *   <div class="qc-modal" id="m" role="dialog" aria-modal="true" data-open="false">
 *     <div class="qc-modal__backdrop" data-qc-close></div>
 *     <div class="qc-modal__dialog">
 *       <button data-qc-close>...</button>
 *       <h2 class="qc-modal__title">...</h2>
 *       ...
 *     </div>
 *   </div>
 *
 *   __QC_UI__.modal.bind(document.getElementById('m'));
 *   __QC_UI__.modal.open(el);   // returns the previously-focused element
 *
 * Pill contract:
 *   <span class="qc-pill" data-state="idle">
 *     <span class="qc-pill__dot"></span>
 *     <span class="qc-pill__label">Idle</span>
 *   </span>
 *
 *   __QC_UI__.pill.setState(el, 'running');
 */

(function () {
  if (globalThis.__QC_UI__) return;

  // ---------- Modal --------------------------------------------------------
  var VALID_PILL_STATES = {
    idle: true, running: true, paused: true, complete: true, error: true,
  };

  function isElement(x) {
    return x && typeof x === 'object' && x.nodeType === 1;
  }

  function focusableSelector() {
    return [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
  }

  function getFocusables(root) {
    if (!isElement(root)) return [];
    var nodes = root.querySelectorAll(focusableSelector());
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      // Visible-ish check: skip nodes hidden via display:none / hidden attr.
      if (n.hasAttribute('hidden')) continue;
      var rect = n.getClientRects && n.getClientRects();
      if (rect && rect.length === 0) continue;
      out.push(n);
    }
    return out;
  }

  // Each modal that's been bound once gets its handlers attached forever.
  var BOUND = '__qcModalBound';
  var STATE = '__qcModalState';

  function bindModal(el, opts) {
    if (!isElement(el)) return;
    if (el[BOUND]) return;
    el[BOUND] = true;
    el[STATE] = {
      lastFocus: null,
      onClose: (opts && typeof opts.onClose === 'function') ? opts.onClose : null,
      closeOnBackdrop: !(opts && opts.closeOnBackdrop === false),
      closeOnEsc:      !(opts && opts.closeOnEsc === false),
    };

    el.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!isElement(t)) return;
      // Walk up to find a [data-qc-close] ancestor within this modal.
      var node = t;
      while (node && node !== el) {
        if (node.hasAttribute && node.hasAttribute('data-qc-close')) {
          if (node.classList.contains('qc-modal__backdrop')
              && !el[STATE].closeOnBackdrop) return;
          closeModal(el);
          return;
        }
        node = node.parentNode;
      }
    });

    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el[STATE].closeOnEsc) {
        ev.stopPropagation();
        closeModal(el);
        return;
      }
      if (ev.key === 'Tab') {
        var foc = getFocusables(el);
        if (foc.length === 0) {
          ev.preventDefault();
          return;
        }
        var first = foc[0];
        var last  = foc[foc.length - 1];
        var active = document.activeElement;
        if (ev.shiftKey && active === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && active === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    });
  }

  function openModal(el) {
    if (!isElement(el)) return null;
    if (!el[BOUND]) bindModal(el);
    if (el.getAttribute('data-open') === 'true') return null;

    var state = el[STATE] || (el[STATE] = {});
    state.lastFocus = (document.activeElement && document.activeElement !== document.body)
      ? document.activeElement : null;

    el.setAttribute('data-open', 'true');
    el.removeAttribute('hidden');
    // Defer focus to allow CSS to paint.
    setTimeout(function () {
      var foc = getFocusables(el);
      var dialog = el.querySelector('.qc-modal__dialog') || el;
      var target = foc[0] || dialog;
      try {
        if (target === dialog && !dialog.hasAttribute('tabindex')) {
          dialog.setAttribute('tabindex', '-1');
        }
        target.focus();
      } catch (_e) { /* noop */ }
    }, 0);
    return state.lastFocus || null;
  }

  function closeModal(el) {
    if (!isElement(el)) return;
    if (el.getAttribute('data-open') !== 'true') return;
    el.setAttribute('data-open', 'false');
    var state = el[STATE];
    try {
      if (state && state.lastFocus && typeof state.lastFocus.focus === 'function') {
        state.lastFocus.focus();
      }
    } catch (_e) { /* noop */ }
    if (state && typeof state.onClose === 'function') {
      try { state.onClose(); } catch (_e) {}
    }
  }

  function toggleModal(el, open) {
    if (!isElement(el)) return;
    var isOpen = el.getAttribute('data-open') === 'true';
    var next = (typeof open === 'boolean') ? open : !isOpen;
    if (next) openModal(el);
    else closeModal(el);
  }

  // ---------- Pill ---------------------------------------------------------
  function setPillState(el, state) {
    if (!isElement(el)) return;
    if (!VALID_PILL_STATES[state]) state = 'idle';
    el.setAttribute('data-state', state);
  }

  // ---------- Expose -------------------------------------------------------
  globalThis.__QC_UI__ = {
    modal: {
      open:   openModal,
      close:  closeModal,
      toggle: toggleModal,
      bind:   bindModal,
    },
    pill: {
      setState: setPillState,
    },
  };
})();
