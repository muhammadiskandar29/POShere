import { getIcon } from './icons.js';

/**
 * Modern Custom Dialog & Toast Service for POShere
 * Replaces native browser alert() and confirm() with high-end glassmorphic modal popups.
 */

// Helper to sanitize message for HTML display while preserving newlines
function formatMessage(msg) {
  if (!msg) return '';
  return String(msg)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

/**
 * Show a sleek confirmation popup modal.
 * @param {Object} options
 * @param {string} options.title - Dialog Title
 * @param {string} options.message - Confirmation description/body
 * @param {string} [options.confirmText='Lanjutkan'] - Text for positive action button
 * @param {string} [options.cancelText='Batal'] - Text for negative action button
 * @param {'danger'|'warning'|'info'|'success'} [options.type='warning'] - Color & tone theme
 * @param {string} [options.icon] - Icon name from icons.js
 * @returns {Promise<boolean>} Resolves true if confirmed, false if cancelled
 */
export function showConfirmDialog({
  title = 'Konfirmasi Tindakan',
  message = '',
  confirmText = 'Ya, Lanjutkan',
  cancelText = 'Batal',
  type = 'warning',
  icon = null
} = {}) {
  return new Promise((resolve) => {
    // Determine icon based on type if not specified
    let iconName = icon;
    if (!iconName) {
      if (type === 'danger') iconName = 'alert-triangle';
      else if (type === 'warning') iconName = 'alert-triangle';
      else if (type === 'success') iconName = 'check-circle';
      else iconName = 'info';
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'pos-dialog-backdrop';
    backdrop.id = 'pos-confirm-dialog-backdrop';

    let confirmBtnClass = 'pos-dialog-btn-confirm-primary';
    if (type === 'danger') confirmBtnClass = 'pos-dialog-btn-confirm-danger';
    else if (type === 'success') confirmBtnClass = 'pos-dialog-btn-confirm-success';

    backdrop.innerHTML = `
      <div class="pos-dialog-card" role="dialog" aria-modal="true" aria-labelledby="pos-dialog-title">
        <div class="pos-dialog-icon-wrap ${type}">
          ${getIcon(iconName, 28, 2.2)}
        </div>
        <h3 id="pos-dialog-title" class="pos-dialog-title">${title}</h3>
        <div class="pos-dialog-message">${formatMessage(message)}</div>
        <div class="pos-dialog-actions">
          <button type="button" class="pos-dialog-btn pos-dialog-btn-cancel" id="pos-dialog-btn-cancel">
            ${cancelText}
          </button>
          <button type="button" class="pos-dialog-btn ${confirmBtnClass}" id="pos-dialog-btn-confirm">
            ${confirmText}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const btnCancel = backdrop.querySelector('#pos-dialog-btn-cancel');
    const btnConfirm = backdrop.querySelector('#pos-dialog-btn-confirm');

    // Auto-focus confirm button
    setTimeout(() => {
      if (btnConfirm) btnConfirm.focus();
    }, 50);

    function cleanup(result) {
      document.removeEventListener('keydown', handleKeyDown);
      backdrop.classList.add('pos-dialog-closing');
      setTimeout(() => {
        if (backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
        resolve(result);
      }, 150);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(false);
      } else if (e.key === 'Enter') {
        // Only trigger if active element isn't the cancel button
        if (document.activeElement !== btnCancel) {
          e.preventDefault();
          cleanup(true);
        }
      }
    }

    btnCancel.addEventListener('click', () => cleanup(false));
    btnConfirm.addEventListener('click', () => cleanup(true));

    // Clicking outside card cancels
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        cleanup(false);
      }
    });

    document.addEventListener('keydown', handleKeyDown);
  });
}

/**
 * Show a custom alert modal (replaces browser alert()).
 * @param {Object} options
 * @param {string} options.title - Alert Title
 * @param {string} options.message - Alert message
 * @param {string} [options.buttonText='Mengerti'] - Text for dismiss button
 * @param {'info'|'warning'|'danger'|'success'} [options.type='info'] - Theme
 * @param {string} [options.icon] - Icon name
 * @returns {Promise<void>}
 */
export function showAlertDialog({
  title = 'Informasi',
  message = '',
  buttonText = 'Mengerti',
  type = 'info',
  icon = null
} = {}) {
  return new Promise((resolve) => {
    let iconName = icon;
    if (!iconName) {
      if (type === 'danger') iconName = 'alert-triangle';
      else if (type === 'warning') iconName = 'alert-triangle';
      else if (type === 'success') iconName = 'check-circle';
      else iconName = 'info';
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'pos-dialog-backdrop';

    let confirmBtnClass = 'pos-dialog-btn-confirm-primary';
    if (type === 'danger') confirmBtnClass = 'pos-dialog-btn-confirm-danger';
    else if (type === 'success') confirmBtnClass = 'pos-dialog-btn-confirm-success';

    backdrop.innerHTML = `
      <div class="pos-dialog-card" role="dialog" aria-modal="true">
        <div class="pos-dialog-icon-wrap ${type}">
          ${getIcon(iconName, 28, 2.2)}
        </div>
        <h3 class="pos-dialog-title">${title}</h3>
        <div class="pos-dialog-message">${formatMessage(message)}</div>
        <div class="pos-dialog-actions">
          <button type="button" class="pos-dialog-btn ${confirmBtnClass}" id="pos-alert-btn-close" style="width: 100%;">
            ${buttonText}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const btnClose = backdrop.querySelector('#pos-alert-btn-close');
    setTimeout(() => {
      if (btnClose) btnClose.focus();
    }, 50);

    function cleanup() {
      document.removeEventListener('keydown', handleKeyDown);
      backdrop.classList.add('pos-dialog-closing');
      setTimeout(() => {
        if (backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
        resolve();
      }, 150);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        cleanup();
      }
    }

    btnClose.addEventListener('click', cleanup);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup();
    });
    document.addEventListener('keydown', handleKeyDown);
  });
}

/**
 * Toast Notification Helper
 */
export function showToast(message, type = 'info', duration = 3200) {
  let container = document.getElementById('pos-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'pos-toast-container';
    container.className = 'pos-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `pos-toast-item ${type}`;

  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  else if (type === 'danger' || type === 'error') iconName = 'alert-triangle';
  else if (type === 'warning') iconName = 'alert-triangle';

  toast.innerHTML = `
    <div class="pos-toast-icon ${type}">
      ${getIcon(iconName, 18, 2)}
    </div>
    <div class="pos-toast-text">${message}</div>
    <button type="button" class="pos-toast-close" title="Tutup">&times;</button>
  `;

  container.appendChild(toast);

  const closeBtn = toast.querySelector('.pos-toast-close');
  let timeoutId = null;

  function removeToast() {
    if (timeoutId) clearTimeout(timeoutId);
    toast.classList.add('pos-toast-closing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 200);
  }

  closeBtn.addEventListener('click', removeToast);
  timeoutId = setTimeout(removeToast, duration);
}

/**
 * Prompt Dialog Helper (replaces browser prompt())
 */
export function showPromptDialog({
  title = 'Input Data',
  message = '',
  defaultValue = '',
  placeholder = '',
  confirmText = 'Lanjutkan',
  cancelText = 'Batal'
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'pos-dialog-backdrop';

    backdrop.innerHTML = `
      <div class="pos-dialog-card" role="dialog" aria-modal="true">
        <div class="pos-dialog-icon-wrap info">
          ${getIcon('message-square', 28, 2.2)}
        </div>
        <h3 class="pos-dialog-title">${title}</h3>
        <div class="pos-dialog-message">${formatMessage(message)}</div>
        <div style="margin-bottom: 1.5rem; text-align: left;">
          <input type="text" id="pos-prompt-input" class="form-control" value="${defaultValue}" placeholder="${placeholder}" style="width: 100%; padding: 0.75rem 0.85rem; font-size: 0.95rem; border: 1.5px solid #cbd5e1; border-radius: 10px;" />
        </div>
        <div class="pos-dialog-actions">
          <button type="button" class="pos-dialog-btn pos-dialog-btn-cancel" id="pos-prompt-btn-cancel">
            ${cancelText}
          </button>
          <button type="button" class="pos-dialog-btn pos-dialog-btn-confirm-primary" id="pos-prompt-btn-confirm">
            ${confirmText}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const input = backdrop.querySelector('#pos-prompt-input');
    const btnCancel = backdrop.querySelector('#pos-prompt-btn-cancel');
    const btnConfirm = backdrop.querySelector('#pos-prompt-btn-confirm');

    setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);

    function cleanup(val) {
      document.removeEventListener('keydown', handleKeyDown);
      backdrop.classList.add('pos-dialog-closing');
      setTimeout(() => {
        if (backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
        resolve(val);
      }, 150);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        cleanup(input.value);
      }
    }

    btnCancel.addEventListener('click', () => cleanup(null));
    btnConfirm.addEventListener('click', () => cleanup(input.value));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup(null);
    });
    document.addEventListener('keydown', handleKeyDown);
  });
}

// Make accessible on window object for convenience
window.showConfirmDialog = showConfirmDialog;
window.showAlertDialog = showAlertDialog;
window.showToast = showToast;
window.showPromptDialog = showPromptDialog;

