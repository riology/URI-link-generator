const state = {
  targetCore: 'all',
  activeTab: 'rawUris',
  staticMode: false,
  publishedUrls: null,
  outputs: {
    rawUris: '',
    base64: '',
    singBoxJson: '',
    xrayJson: '',
  },
  nodes: [],
  urls: {},
  editingNodeIndex: null,
};

// API base: empty = same origin (local Node server). Set in config.js for a Cloudflare Worker.
const API_BASE = ((window.APP_CONFIG && window.APP_CONFIG.apiBase) || '').trim().replace(/\/+$/, '');
const apiUrl = (path) => API_BASE + path;

// Per-browser subscription identity (random ID + secret edit token)
const IDENTITY_KEY = 'linkgen.identity.v1';

function randomString(len) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function resetIdentity() {
  const identity = { id: randomString(16), token: randomString(32) };
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // localStorage unavailable; identity lasts for this page load only
  }
  return identity;
}

function getIdentity() {
  try {
    const saved = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null');
    if (saved && saved.id && saved.token) return saved;
  } catch {
    // fall through
  }
  return resetIdentity();
}

// DOM Elements
const rawInputEl = document.getElementById('rawInput');
const subNameInputEl = document.getElementById('subNameInput');
const remarkPrefixInputEl = document.getElementById('remarkPrefixInput');
const chkDeduplicateEl = document.getElementById('chkDeduplicate');
const chkRenumberEl = document.getElementById('chkRenumber');
const outputTextareaEl = document.getElementById('outputTextarea');
const nodesTableBodyEl = document.getElementById('nodesTableBody');
const nodeSearchInputEl = document.getElementById('nodeSearchInput');

const urlSingBoxSubEl = document.getElementById('urlSingBoxSub');
const urlXraySubEl = document.getElementById('urlXraySub');
const urlSingBoxJsonEl = document.getElementById('urlSingBoxJson');
const btnHiddifyDeepLinkEl = document.getElementById('btnHiddifyDeepLink');
const btnV2rayDeepLinkEl = document.getElementById('btnV2rayDeepLink');
const qrContainerEl = document.getElementById('qrContainer');
const qrCaptionEl = document.getElementById('qrCaption');

// Stats Elements
const statInputTypeEl = document.getElementById('statInputType');
const statActiveCountEl = document.getElementById('statActiveCount');
const statSingBoxCountEl = document.getElementById('statSingBoxCount');
const statXrayOnlyCountEl = document.getElementById('statXrayOnlyCount');
const statFixesCountEl = document.getElementById('statFixesCount');

// Modal Elements
const nodeModalBackdrop = document.getElementById('nodeModalBackdrop');
const modalTitleEl = document.getElementById('modalTitle');
const editProtocolEl = document.getElementById('editProtocol');
const editRemarkEl = document.getElementById('editRemark');
const editHostEl = document.getElementById('editHost');
const editPortEl = document.getElementById('editPort');
const editAuthEl = document.getElementById('editAuth');
const editTransportEl = document.getElementById('editTransport');
const editSecurityEl = document.getElementById('editSecurity');
const editFlowOrMethodEl = document.getElementById('editFlowOrMethod');
const editSniEl = document.getElementById('editSni');
const editFpEl = document.getElementById('editFp');
const editSidEl = document.getElementById('editSid');
const editPbkEl = document.getElementById('editPbk');
const editPathEl = document.getElementById('editPath');
const editWsHostEl = document.getElementById('editWsHost');
const editPreviewUriEl = document.getElementById('editPreviewUri');

function updateModeBadge() {
  const dot = document.getElementById('modeDot');
  const label = document.getElementById('modeBadgeText');
  if (!dot || !label) return;
  dot.classList.remove('is-live', 'is-static');
  if (state.staticMode) {
    dot.classList.add('is-static');
    label.textContent = 'Static mode';
  } else {
    dot.classList.add('is-live');
    label.textContent = 'Live server';
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2200);
}

async function copyText(text, label = 'Copied to clipboard') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(label);
  } catch {
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    showToast(label);
  }
}

function renderClientQr(text) {
  if (!text || typeof window.qrcode !== 'function') return '';
  try {
    const qr = window.qrcode(0, 'L');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    return '';
  }
}

function parseLocally(payload) {
  if (!window.VpnCore) {
    throw new Error('VpnCore client library is not loaded.');
  }
  const result = window.VpnCore.processRawInput(payload.rawInput, {
    targetCore: payload.targetCore,
    deduplicate: payload.deduplicate,
    remarkPrefix: payload.remarkPrefix,
    renumberRemarks: payload.renumberRemarks,
  });
  const sbResult = window.VpnCore.processRawInput(payload.rawInput, {
    targetCore: 'singbox',
    deduplicate: payload.deduplicate,
    remarkPrefix: payload.remarkPrefix,
    renumberRemarks: payload.renumberRemarks,
  });
  const xrayResult = window.VpnCore.processRawInput(payload.rawInput, {
    targetCore: 'xray',
    deduplicate: payload.deduplicate,
    remarkPrefix: payload.remarkPrefix,
    renumberRemarks: payload.renumberRemarks,
  });

  const urls = {
    universalSub: result.outputs.base64,
    singBoxSub: sbResult.outputs.base64,
    xraySub: xrayResult.outputs.base64,
    singBoxJsonUrl: result.nodes.length
      ? `data:application/json;base64,${window.VpnCore.safeBase64Encode(sbResult.outputs.singBoxJson)}`
      : '',
    hiddifyDeepLink: '#static-mode',
    v2rayNgDeepLink: '#static-mode',
  };

  const qrTarget = result.nodes[0]?.normalizedUri || result.outputs.rawUris;
  const qrSubSvg = renderClientQr(qrTarget);

  return {
    ok: true,
    urls,
    qrSubSvg,
    qrCaption: result.nodes[0] ? `Node QR: ${result.nodes[0].remark}` : 'QR Preview',
    ...result,
  };
}

async function publishSubscription(payload, allowRetry = true) {
  const identity = getIdentity();
  try {
    const res = await fetch(apiUrl('/api/parse'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, subId: identity.id, subToken: identity.token, saveToSub: true }),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 403 && data && data.code === 'TOKEN_MISMATCH' && allowRetry) {
      resetIdentity();
      return publishSubscription(payload, false);
    }
    if (!res.ok || !data || !data.ok) {
      showToast('Publish failed: ' + ((data && data.error) || `HTTP ${res.status}`));
      return null;
    }
    return data;
  } catch {
    showToast('Could not reach the subscription API');
    return null;
  }
}

async function generateAndParse({ publish = false } = {}) {
  const rawInput = rawInputEl.value;
  const payload = {
    rawInput,
    targetCore: state.targetCore,
    deduplicate: chkDeduplicateEl.checked,
    remarkPrefix: remarkPrefixInputEl.value.trim(),
    renumberRemarks: chkRenumberEl.checked,
    subName: subNameInputEl.value.trim() || 'VPN Subscription',
  };

  let published = false;
  try {
    // Parsing always runs in the browser; the API is only used to publish subscriptions.
    const data = parseLocally(payload);

    if (!state.staticMode) {
      if (publish && data.nodes.length > 0) {
        const result = await publishSubscription(payload);
        if (result && result.urls && result.urls.universalSub) {
          state.publishedUrls = result.urls;
          published = true;
        }
      }
      data.urls = state.publishedUrls || {};
      data.qrSubSvg = state.publishedUrls ? renderClientQr(state.publishedUrls.universalSub) : '';
      data.qrCaption = 'Subscription QR';
    }

    updateModeBadge();

    if (!data.ok) {
      showToast('Error: ' + (data.error || 'Parse failed'));
      return;
    }

    state.nodes = data.nodes || [];
    state.outputs = data.outputs || {};
    state.urls = data.urls || {};

    // Update stats
    const typeLabels = {
      raw: 'Raw URI List',
      base64: 'Base64 Subscription',
      mixed: 'Mixed Raw + Base64',
      json: 'JSON Outbounds',
      empty: 'Empty',
    };
    statInputTypeEl.textContent = typeLabels[data.stats.inputType] || data.stats.inputType;
    statActiveCountEl.textContent = `${data.stats.activeCount} / ${data.stats.totalExtracted}`;
    statSingBoxCountEl.textContent = data.stats.singBoxCompatibleCount;
    statXrayOnlyCountEl.textContent = data.stats.xrayOnlyCount;
    statFixesCountEl.textContent = data.stats.fixesAppliedCount;

    // Update URLs
    urlSingBoxSubEl.value = data.urls.singBoxSub || '';
    urlXraySubEl.value = data.urls.xraySub || '';
    urlSingBoxJsonEl.value = data.urls.singBoxJsonUrl || '';
    btnHiddifyDeepLinkEl.href = data.urls.hiddifyDeepLink || '#';
    btnV2rayDeepLinkEl.href = data.urls.v2rayNgDeepLink || '#';

    if (data.qrSubSvg) {
      qrContainerEl.innerHTML = data.qrSubSvg;
      qrCaptionEl.textContent = data.qrCaption || 'Subscription QR';
    } else {
      const hint = state.staticMode ? 'Click QR on any node row to preview' : 'Click Generate to publish your subscription';
      qrContainerEl.innerHTML = `<div style="padding:16px;font-size:12px;color:#64748b;text-align:center;">${hint}</div>`;
      qrCaptionEl.textContent = state.staticMode ? 'Static mode' : 'Not published yet';
    }

    updateOutputTextarea();
    renderNodesTable();
  } catch (err) {
    console.error(err);
  }
  return published;
}

function updateOutputTextarea() {
  outputTextareaEl.value = state.outputs[state.activeTab] || '';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNodesTable() {
  const filter = (nodeSearchInputEl.value || '').trim().toLowerCase();
  const filtered = state.nodes.filter((n) => {
    if (!filter) return true;
    const hay = [
      n.remark,
      n.protocol,
      n.transport,
      n.host,
      n.port,
      n.sni,
      n.security,
      n.compatibility?.badge,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(filter);
  });

  if (filtered.length === 0) {
    nodesTableBodyEl.innerHTML = `<tr><td colspan="8" class="empty-state">No matching VPN nodes found. Paste raw links or Base64 above.</td></tr>`;
    return;
  }

  nodesTableBodyEl.innerHTML = filtered
    .map((node, idx) => {
      const compatClass = node.compatibility.both
        ? 'badge-singbox'
        : node.compatibility.xray
        ? 'badge-xray'
        : 'badge-json';

      const flowInfo = node.flow
        ? `<span class="sub-detail">flow: ${escapeHtml(node.flow)}</span>`
        : node.method
        ? `<span class="sub-detail">cipher: ${escapeHtml(node.method)}</span>`
        : '';

      const transportExtra = node.path
        ? `<span class="sub-detail">path: ${escapeHtml(node.path)}</span>`
        : node.serviceName
        ? `<span class="sub-detail">service: ${escapeHtml(node.serviceName)}</span>`
        : '';

      const secDetails = [];
      if (node.sni) secDetails.push(`SNI: ${escapeHtml(node.sni)}`);
      if (node.security === 'reality' && node.pbk) {
        secDetails.push(`fp: ${escapeHtml(node.fp)} • sid: ${escapeHtml(node.sid || 'empty')}`);
      }

      const fixesHtml =
        node.fixes && node.fixes.length > 0
          ? `<span class="badge badge-fix" title="${escapeHtml(node.fixes.join('\n'))}">${node.fixes.length} fix${
              node.fixes.length > 1 ? 'es' : ''
            }</span>`
          : `<span class="sub-detail">Clean</span>`;

      const credWarning = node.sameCredentialsAs
        ? `<span class="sub-detail" style="color:var(--warning)">Shares UUID/PBK with ${escapeHtml(
            node.sameCredentialsAs
          )}</span>`
        : '';

      return `
        <tr>
          <td class="mono-cell">${idx + 1}</td>
          <td>
            <strong>${escapeHtml(node.remark)}</strong>
            ${credWarning}
          </td>
          <td>
            <span class="badge badge-proto">${escapeHtml(node.protocol.toUpperCase())}</span>
            <span class="mono-cell"> / ${escapeHtml(node.transport)}</span>
            ${flowInfo}
            ${transportExtra}
          </td>
          <td class="mono-cell">
            ${escapeHtml(node.host)}:${escapeHtml(node.port)}
          </td>
          <td>
            <strong>${escapeHtml(node.security.toUpperCase())}</strong>
            <span class="sub-detail">${secDetails.join('<br/>') || '—'}</span>
          </td>
          <td>
            <span class="badge ${compatClass}" title="${escapeHtml(
        (node.compatibility.notes || []).join(' ')
      )}">${escapeHtml(node.compatibility.badge)}</span>
          </td>
          <td>${fixesHtml}</td>
          <td>
            <div class="row-actions">
              <button class="btn btn-sm btn-secondary" onclick="copyNodeUri(${idx})" title="Copy normalized URI">Copy</button>
              <button class="btn btn-sm btn-outline" onclick="showNodeQr(${idx})" title="Show QR Code">QR</button>
              <button class="btn btn-sm btn-ghost" onclick="openEditModal(${idx})" title="Edit node parameters">Edit</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

window.copyNodeUri = function (idx) {
  const node = state.nodes[idx];
  if (!node) return;
  copyText(node.normalizedUri, `Copied ${node.remark} link!`);
};

window.showNodeQr = async function (idx) {
  const node = state.nodes[idx];
  if (!node) return;
  await updateQrPreview(node.normalizedUri, `Node: ${node.remark}`);
  showToast(`QR updated for ${node.remark}`);
};

async function updateQrPreview(text, caption) {
  if (!text) return;
  const svg = renderClientQr(text);
  qrContainerEl.innerHTML =
    svg || '<div style="padding:16px;font-size:12px;color:#64748b;text-align:center;">Payload too large for QR — use Copy</div>';
  qrCaptionEl.textContent = caption;
}

// Single Node Editor / Builder Modal
window.openEditModal = function (idx = null) {
  state.editingNodeIndex = idx;
  if (idx !== null && state.nodes[idx]) {
    const n = state.nodes[idx];
    modalTitleEl.textContent = `Edit Node: ${n.remark}`;
    editProtocolEl.value = n.protocol || 'vless';
    editRemarkEl.value = n.remark || '';
    editHostEl.value = n.host || '';
    editPortEl.value = n.port || 443;
    editAuthEl.value = n.uuid || n.password || '';
    editTransportEl.value = n.transport || 'tcp';
    editSecurityEl.value = n.security || 'reality';
    editFlowOrMethodEl.value = n.protocol === 'ss' ? n.method || 'aes-256-gcm' : n.flow || '';
    editSniEl.value = n.sni || '';
    editFpEl.value = n.fp || 'chrome';
    editSidEl.value = n.sid || '';
    editPbkEl.value = n.pbk || '';
    editPathEl.value = n.transport === 'grpc' ? n.serviceName || '' : n.path || '';
    editWsHostEl.value = n.wsHost || '';
  } else {
    modalTitleEl.textContent = 'Build custom VPN node';
    editProtocolEl.value = 'vless';
    editRemarkEl.value = '';
    editHostEl.value = '';
    editPortEl.value = 443;
    editAuthEl.value = '';
    editTransportEl.value = 'tcp';
    editSecurityEl.value = 'reality';
    editFlowOrMethodEl.value = 'xtls-rprx-vision';
    editSniEl.value = '';
    editFpEl.value = 'chrome';
    editSidEl.value = '';
    editPbkEl.value = '';
    editPathEl.value = '';
    editWsHostEl.value = '';
  }
  nodeModalBackdrop.classList.remove('hidden');
  refreshModalPreview();
};

function buildNodeFromModal() {
  const protocol = editProtocolEl.value;
  const transport = editTransportEl.value;
  const authVal = editAuthEl.value.trim();
  const flowOrMethod = editFlowOrMethodEl.value.trim();
  const pathOrService = editPathEl.value.trim();

  return {
    protocol,
    remark: editRemarkEl.value.trim() || `${protocol}-node`,
    host: editHostEl.value.trim(),
    port: parseInt(editPortEl.value, 10) || 443,
    uuid: ['vless', 'vmess', 'tuic'].includes(protocol) ? authVal : '',
    password: ['ss', 'trojan', 'hy2', 'tuic'].includes(protocol) ? authVal : '',
    method: protocol === 'ss' ? flowOrMethod || 'aes-256-gcm' : '',
    flow: protocol === 'vless' ? flowOrMethod : '',
    encryption: 'none',
    transport,
    security: editSecurityEl.value,
    sni: editSniEl.value.trim(),
    fp: editFpEl.value,
    sid: editSidEl.value.trim(),
    pbk: editPbkEl.value.trim(),
    path: transport === 'grpc' ? '' : pathOrService,
    serviceName: transport === 'grpc' ? pathOrService : '',
    wsHost: editWsHostEl.value.trim(),
    mode: transport === 'xhttp' ? 'auto' : '',
  };
}

async function refreshModalPreview() {
  const node = buildNodeFromModal();
  try {
    editPreviewUriEl.value = node.host ? window.VpnCore.toShareUri(node) : '';
  } catch (e) {
    editPreviewUriEl.value = '';
    console.error(e);
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
  const handleHiddifyClick = (e) => {
    if (state.staticMode || !state.publishedUrls) {
      e.preventDefault();
      if (!state.staticMode) {
        showToast('Click Generate to publish your subscription first');
      } else if (state.urls.singBoxSub) {
        copyText(state.urls.singBoxSub, 'Sing-box Base64 copied — in Hiddify tap + → Add from clipboard');
      } else {
        showToast('Paste VPN links or use Build node first');
      }
    }
  };
  const handleV2rayClick = (e) => {
    if (state.staticMode || !state.publishedUrls) {
      e.preventDefault();
      if (!state.staticMode) {
        showToast('Click Generate to publish your subscription first');
      } else if (state.urls.xraySub) {
        copyText(state.urls.xraySub, 'Xray Base64 copied — in v2rayNG tap + → Import from clipboard');
      } else {
        showToast('Paste VPN links or use Build node first');
      }
    }
  };
  btnHiddifyDeepLinkEl.addEventListener('click', handleHiddifyClick);
  btnV2rayDeepLinkEl.addEventListener('click', handleV2rayClick);

  // Detect API (Cloudflare Worker or local Node server) vs static-only mode
  try {
    const res = await fetch(apiUrl('/api/health'));
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      state.staticMode = true;
    }
  } catch {
    state.staticMode = true;
  }
  await generateAndParse();

  document.getElementById('btnClearInput').addEventListener('click', () => {
    rawInputEl.value = '';
    generateAndParse();
  });

  document.getElementById('btnGenerate').addEventListener('click', async () => {
    if (!rawInputEl.value.trim()) {
      showToast('Paste VPN links or Base64 above, or click Build node');
      return;
    }
    const published = await generateAndParse({ publish: true });
    if (state.staticMode) {
      showToast('Links generated');
    } else if (published) {
      showToast('Subscription published');
    }
  });

  // Live auto-parse on paste or input changes
  let debounceTimer;
  rawInputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(generateAndParse, 300);
  });

  chkDeduplicateEl.addEventListener('change', generateAndParse);
  chkRenumberEl.addEventListener('change', generateAndParse);
  remarkPrefixInputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(generateAndParse, 300);
  });

  // Core filter segmented buttons
  document.querySelectorAll('#coreFilterGroup .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#coreFilterGroup .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.targetCore = btn.dataset.core;
      generateAndParse();
    });
  });

  // Output Tabs
  document.querySelectorAll('#outputTabsNav .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#outputTabsNav .tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      updateOutputTextarea();
    });
  });

  // Copy buttons for subscription URLs
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.copyTarget;
      const input = document.getElementById(targetId);
      if (input) copyText(input.value, 'Subscription URL copied!');
    });
  });

  // QR triggers for subscription URLs
  document.querySelectorAll('.qr-trigger-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sourceId = btn.dataset.qrSource;
      const label = btn.dataset.qrLabel;
      const input = document.getElementById(sourceId);
      if (input && input.value) {
        updateQrPreview(input.value, label);
      }
    });
  });

  // Copy & Download active output tab
  document.getElementById('btnCopyActiveTab').addEventListener('click', () => {
    copyText(outputTextareaEl.value, `Copied ${state.activeTab} output!`);
  });

  document.getElementById('btnDownloadActiveTab').addEventListener('click', () => {
    const content = outputTextareaEl.value;
    if (!content) return;
    const extMap = {
      rawUris: 'vpn-nodes.txt',
      base64: 'subscription-base64.txt',
      singBoxJson: 'sing-box-profile.json',
      xrayJson: 'xray-config.json',
    };
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = extMap[state.activeTab] || 'vpn-output.txt';
    a.click();
    URL.revokeObjectURL(url);
  });

  nodeSearchInputEl.addEventListener('input', renderNodesTable);

  // Modal controls
  document.getElementById('btnNewNodeModal').addEventListener('click', () => window.openEditModal(null));
  document.getElementById('btnCloseModal').addEventListener('click', () => nodeModalBackdrop.classList.add('hidden'));
  document.getElementById('btnCancelModal').addEventListener('click', () => nodeModalBackdrop.classList.add('hidden'));

  [
    editProtocolEl,
    editRemarkEl,
    editHostEl,
    editPortEl,
    editAuthEl,
    editTransportEl,
    editSecurityEl,
    editFlowOrMethodEl,
    editSniEl,
    editFpEl,
    editSidEl,
    editPbkEl,
    editPathEl,
    editWsHostEl,
  ].forEach((el) => {
    el.addEventListener('input', refreshModalPreview);
    el.addEventListener('change', refreshModalPreview);
  });

  document.getElementById('btnCopyModalUri').addEventListener('click', () => {
    copyText(editPreviewUriEl.value, 'Copied generated node link!');
  });

  document.getElementById('btnSaveModalNode').addEventListener('click', async () => {
    await refreshModalPreview();
    const newUri = editPreviewUriEl.value;
    if (!newUri) return;

    if (state.editingNodeIndex !== null && state.nodes[state.editingNodeIndex]) {
      const oldNode = state.nodes[state.editingNodeIndex];
      const currentText = rawInputEl.value;
      if (oldNode.originalUri && currentText.includes(oldNode.originalUri)) {
        rawInputEl.value = currentText.replace(oldNode.originalUri, newUri);
      } else {
        const updatedList = state.nodes.map((n, i) => (i === state.editingNodeIndex ? newUri : n.normalizedUri));
        rawInputEl.value = updatedList.join('\n');
      }
      showToast('Updated node in list!');
    } else {
      rawInputEl.value = (rawInputEl.value.trim() + '\n' + newUri).trim();
      showToast('Added custom node to list!');
    }

    nodeModalBackdrop.classList.add('hidden');
    generateAndParse();
  });
});
