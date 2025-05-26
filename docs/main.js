// === CONFIG ===
const SB_ACTION_NAME = "Main Dashboard System : Actions Summary Broadcaster";
const SB_WS_HOST = "127.0.0.1";
const SB_WS_PORT = 8080;
const SB_WS_PASS = "streamer.bot";

// --- Etat UI groupes (collapsés ou non)
let collapsedGroups = {};

// === STREAMERBOT CONNECTION ===
const client = new StreamerbotClient({
  host: SB_WS_HOST,
  port: SB_WS_PORT,
  password: SB_WS_PASS,
  endpoint: "/",
  subscribe: "*",
  onConnect: async () => {
    console.log("WebSocket connecté !");
    document.body.classList.add("sb-connected");
    try {
      const resp = await client.getInfo();
      if (resp.info) {
        document.getElementById('instance-info').innerHTML = `
          <div><b>Nom instance:</b> <span style="color:#fff">${resp.info.instanceName || "(non nommé)"}</span></div>
          <div><b>Version:</b> <span style="color:#ffe15e">${resp.info.version}</span></div>
          <div><b>Plateforme:</b> ${resp.info.platform}</div>
          <div style="font-size:0.93em; color:#9ef; margin-top:3px;">${resp.info.machineName || ""}</div>
        `;
      }
    } catch (e) {
      document.getElementById('instance-info').innerHTML = "<span style='color:#faa'>Erreur connexion instance</span>";
    }
    fetchActions();
  },
  onDisconnect: () => {
    console.warn("Déconnecté de Streamer.bot.");
    document.body.classList.remove("sb-connected");
    document.getElementById('instance-info').innerHTML = "<span style='color:#faa'>Déconnecté</span>";
    document.getElementById("actions-tree").innerHTML = "";
    document.getElementById("action-detail").innerHTML = "";
  }
});

let actionsCache = [];
let actionsSummaryCache = [];
let actionsMode = "basic"; // "basic" ou "summary"

// =========== 1. GET ACTIONS ================
function fetchActions() {
  client.getActions().then(resp => {
    actionsCache = resp.actions || [];
    actionsMode = "basic";
    renderActionsTree(actionsCache);
  });
}

// =========== 2. GET SUMMARY (par action C#) =====
document.getElementById("get-actions-summary").onclick = async function() {
  const resp = await client.getActions();
  const action = resp.actions.find(a => a.name && a.name.trim().toLowerCase() === SB_ACTION_NAME.trim().toLowerCase());
  if (!action) {
    alert("Action 'Actions Summary Broadcaster' non trouvée.");
    return;
  }
  await client.doAction({ id: action.id });
  // Attend la réponse via Broadcast.Custom
};

// =========== 3. LISTEN TO SUMMARY BROADCAST ==========
client.on("Broadcast.Custom", ({ data }) => {
  if (data?.type === "actionsSummary" && data?.summary) {
    actionsSummaryCache = data.summary;
    actionsMode = "summary";
    console.log("Résumé des actions reçu :", actionsSummaryCache);
    // Affiche aussi un exemple pour debug
    if (actionsSummaryCache[0]) console.log("Exemple action[0]:", actionsSummaryCache[0]);
    renderActionsTree(actionsSummaryCache, true);
    showSummaryIndicator();
  }
});

// Petit badge "Résumé complet chargé"
function showSummaryIndicator() {
  let old = document.getElementById("summary-badge");
  if (old) old.remove();
  const badge = document.createElement("div");
  badge.id = "summary-badge";
  badge.style = "background:#212; color:#0ff; padding:6px 14px; border-radius:8px; margin: 10px 0 14px 0; text-align:center; font-size:1em; font-weight:bold; letter-spacing:.5px;";
  badge.innerHTML = "<span style='color:#0ff8de;'>✓</span> Résumé complet des actions affiché";
  document.querySelector(".sidebar").insertBefore(badge, document.getElementById("get-actions-summary").nextSibling);
}

// =========== 4. UI RENDERING ================
function renderActionsTree(actions, isSummary = false) {
  const tree = document.getElementById("actions-tree");
  tree.innerHTML = "";
  const byGroup = {};
  actions.forEach(action => {
    const group = action.group || "Sans groupe";
    if (!byGroup[group]) byGroup[group] = [];
    byGroup[group].push(action);
  });

  Object.entries(byGroup).forEach(([group, groupActions]) => {
    if (!(group in collapsedGroups)) collapsedGroups[group] = false; // default open

    // Group header (collapsible)
    const groupDiv = document.createElement("div");
    groupDiv.className = "action-group";
    groupDiv.innerHTML = `
      <span class="group-toggle" style="user-select:none;cursor:pointer;font-size:1.07em;">
        [${collapsedGroups[group] ? "+" : "−"}]
      </span>
      <span style="margin-left:7px;">${group}</span>
    `;
    groupDiv.onclick = e => {
      collapsedGroups[group] = !collapsedGroups[group];
      renderActionsTree(isSummary ? actionsSummaryCache : actionsCache, isSummary);
      e.stopPropagation();
    };
    tree.appendChild(groupDiv);

    // Actions list
    const ul = document.createElement("ul");
    ul.className = "actions-tree";
    if (collapsedGroups[group]) {
      ul.style.display = "none";
    }
    groupActions.forEach((action, idx) => {
      const li = renderActionNode(action, isSummary, 0, idx);
      ul.appendChild(li);
    });
    tree.appendChild(ul);
  });
}

// — Ligne d’action (zebra striping + colonnes)
function renderActionNode(action, isSummary = false, depth = 0, rowIdx = 0) {
  const li = document.createElement("li");
  li.className = "action-node";
  li.classList.add(rowIdx % 2 === 0 ? "row-even" : "row-odd");
  li.innerHTML = `
    <span class="action-label">${"—".repeat(depth)} ${escapeHTML(action.name)}</span>
    <span class="status-col">
      <span class="${action.enabled ? "enabled-badge" : "disabled-badge"}">${action.enabled ? "on" : "off"}</span>
    </span>
    ${action.triggers && action.triggers.length ? `<span class="trigger-badge">${action.triggers.length} triggers</span>` : ""}
  `;
  li.onclick = e => {
    renderActionDetail(action, isSummary);
    e.stopPropagation();
  };
  // Sous-actions (indentées et zebra aussi)
  if (action.subActions && action.subActions.length) {
    const subUl = document.createElement("ul");
    subUl.className = "actions-tree";
    action.subActions.forEach((sub, idx) => {
      const subLi = renderActionNode(sub, isSummary, depth + 1, idx);
      subUl.appendChild(subLi);
    });
    li.appendChild(subUl);
  }
  return li;
}

// — Détail de l’action (récursif : sous-actions + code)
function renderActionDetail(action, isSummary = false) {
  const panel = document.getElementById("action-detail");
  panel.innerHTML = `
    <div class="detail-title">${escapeHTML(action.name)}</div>
    <div class="detail-block">
      <b>Groupe:</b> ${escapeHTML(action.group || "-")}<br>
      <b>Etat:</b> <span class="${action.enabled ? "enabled-badge" : "disabled-badge"}">${action.enabled ? "on" : "off"}</span>
      ${action.triggers && action.triggers.length ? `<div style="margin-top:7px;"><b>Triggers:</b><ul class="trigger-list">${action.triggers.map(t =>
        `<li class="trigger-item"><b>Type:</b> ${t.type} ${t.enabled ? '<span style="color:#8ff;">on</span>' : '<span style="color:#faa;">off</span>'}</li>`
      ).join("")}</ul></div>` : ""}
    </div>
    ${renderSubActionsDetail(action.subActions, isSummary)}
    ${(isSummary && action.byteCode) ? `
      <div class="detail-block">
        <b>Code C# (décodé):</b>
        <pre class="bytecode-block">${escapeHTML(action.byteCode)}</pre>
      </div>
    ` : ""}
  `;
  document.querySelectorAll('.action-node').forEach(n => n.classList.remove('selected'));
  highlightSelectedInTree(action.name);
}

// — Rendu récursif des sous-actions dans le détail (avec code éventuel)
function renderSubActionsDetail(subActions, isSummary) {
  if (!subActions || !subActions.length) return "";
  return `
    <div class="detail-block" style="background:#21292f;"><b>Sous-actions :</b>
      <ul class="actions-tree">
        ${subActions.map(sub => `
          <li>
            <span>${escapeHTML(sub.name)}</span>
            ${sub.enabled === false ? '<span class="disabled-badge" style="margin-left:7px;">off</span>' : ''}
            ${sub.enabled === true ? '<span class="enabled-badge" style="margin-left:7px;">on</span>' : ''}
            ${(isSummary && sub.byteCode) ? "<span style='color:#ffe15e; margin-left:8px;'>(C#)</span>" : ""}
            ${sub.subActions && sub.subActions.length ? renderSubActionsDetail(sub.subActions, isSummary) : ""}
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

// — Utilitaire d’échappement HTML
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}

// — Highlight ligne sélectionnée
function highlightSelectedInTree(actionName) {
  document.querySelectorAll('.action-node').forEach(li => {
    if (li.textContent.trim().includes(actionName)) li.classList.add('selected');
  });
}

// --- Sidebar Resizer / Split bar ---
const sidebar = document.querySelector('.sidebar');
const resizer = document.getElementById('sidebar-resizer');
let isResizing = false;

resizer.addEventListener('mousedown', function(e) {
  isResizing = true;
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', function(e) {
  if (!isResizing) return;
  const dashboardRect = document.querySelector('.dashboard').getBoundingClientRect();
  let newW = e.clientX - dashboardRect.left;
  if (newW < 220) newW = 220;
  if (newW > 550) newW = 550;
  sidebar.style.width = newW + 'px';
});

document.addEventListener('mouseup', function(e) {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});
